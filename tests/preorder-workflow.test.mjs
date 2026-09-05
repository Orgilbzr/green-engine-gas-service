import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const statusModule = { exports: {} };
vm.runInNewContext(compile(readFileSync(new URL('../app/preorder-status.ts', import.meta.url), 'utf8')), statusModule);
const { matchesPreorderFilter, operationalPreorderStatus } = statusModule.exports;
const row = (status, id = 1) => ({ id, status, customer: 'Test customer', vehicle: 'Test car', phone: '12345678', source: 'manual', createdAt: '2026-09-05', manufactureYear: 2020 });

function renderCode(code, bindings) {
  const context = { exports: {}, require, ...bindings };
  vm.runInNewContext(compile(code), context);
  return renderToStaticMarkup(React.createElement(context.exports.default));
}
const tableStart = source.indexOf('<table className="preorder-table">');
const table = source.slice(tableStart, source.indexOf('</table>', tableStart) + 8);
function renderRows(rows, canEdit = true) {
  return renderCode(`export default function Table() { return (${table}); }`, {
    visiblePreorders: rows, canEdit, operationalPreorderStatus,
    preorderSource: value => value, preorderDate: value => value,
  });
}

test('Active, Cancelled and All exclude converted and preserve legacy history', () => {
  for (const status of ['new', 'contacted', 'active', 'Шинэ', 'Холбогдсон']) {
    assert.equal(matchesPreorderFilter(row(status), 'active'), true);
    assert.equal(operationalPreorderStatus(row(status)), 'new');
  }
  for (const status of ['converted', 'Үндсэн захиалга болсон']) {
    for (const filter of ['active', 'cancelled', 'all']) assert.equal(matchesPreorderFilter(row(status), filter), false);
  }
  assert.equal(matchesPreorderFilter({ ...row('new'), convertedBookingId: 10 }, 'all'), false);
  for (const status of ['cancelled', 'Цуцлагдсан']) {
    assert.equal(matchesPreorderFilter(row(status), 'active'), false);
    assert.equal(matchesPreorderFilter(row(status), 'cancelled'), true);
    assert.equal(matchesPreorderFilter(row(status), 'all'), true);
  }
  assert.equal(operationalPreorderStatus(row('legacy-other')), 'unknown');
  assert.equal(matchesPreorderFilter(row('legacy-other'), 'all'), true);
});

test('Active rows have exactly Convert and Cancel, with no status dropdown', () => {
  for (const status of ['new', 'contacted']) {
    const html = renderRows([row(status)]);
    assert.equal((html.match(/<button/g) || []).length, 2);
    assert.match(html, /Үндсэн захиалга болгох/);
    assert.match(html, /Цуцлах/);
    assert.match(html, /status-new">Шинэ/);
    assert.doesNotMatch(html, /<select/);
  }
});

test('Cancelled and unknown rows have no actions; restricted roles have none', () => {
  assert.match(renderRows([row('cancelled')]), /status-cancelled">Цуцлагдсан/);
  for (const status of ['cancelled', 'Цуцлагдсан', 'legacy-other']) assert.doesNotMatch(renderRows([row(status)]), /<button|<select/);
  assert.doesNotMatch(renderRows([row('new')], false), /<button/);
});

test('Confirmation dialog contains the exact prompt, dismiss and destructive confirm', () => {
  const start = source.indexOf('function PreorderCancelDialog(');
  const end = source.indexOf('\nfunction BootScreen()', start);
  const html = renderCode(source.slice(start, end) + '\nexport default () => <PreorderCancelDialog customer="Test" saving={false} error="" onClose={() => {}} onConfirm={() => {}} />;', { useRef: () => ({ current: null }), useEffect: () => {} });
  assert.match(html, /<dialog/);
  assert.match(html, /Энэ урьдчилсан захиалгыг цуцлах уу\?/);
  assert.match(html, /Болих/);
  assert.match(html, /preorder-cancel-confirm/);
});

function extractFunction(name, nextName) {
  const start = source.indexOf(`  async function ${name}(`);
  return compile(source.slice(start, source.indexOf(`  async function ${nextName}(`, start)));
}
function runFunction(code, name, bindings) {
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings));
}

test('Conversion success removes only the confirmed row; failure retains it; override success also removes it', async () => {
  for (const outcome of ['success', 'failure', 'override']) {
    let rows = [row('new'), row('new', 2)], bookings = [], calls = 0, notice;
    const booking = { id: 10, bookingNo: 'BK-10' };
    const submit = runFunction(extractFunction('submit', 'update'), 'submit', {
      submitting: false, bookings: [], form: {}, BOOKING_CAPACITY: 3, isActiveBooking: () => true,
      setSubmitting: () => {}, duplicateCheck: null, pendingPreorderId: 1,
      window: { confirm: () => true }, DOMException,
      clientRequest: async () => {
        calls++;
        const failed = outcome === 'failure' || (outcome === 'override' && calls === 1);
        return { ok: !failed, status: failed ? 409 : 201, json: async () => failed ? { error: outcome === 'override' ? 'Энэ автомашинд идэвхтэй захиалга байна.' : 'Failed' } : { booking } };
      },
      setPreOrders: update => rows = update(rows), setBookings: update => bookings = update(bookings),
      setForm: () => {}, emptyForm: () => ({}), setPendingPreorderId: () => {}, setNotice: value => notice = value, setView: () => {},
    });
    await submit({ preventDefault() {} });
    assert.equal(rows.length, outcome === 'failure' ? 2 : 1);
    assert.equal(bookings.length, outcome === 'failure' ? 0 : 1);
    if (outcome === 'failure') assert.equal(notice, 'Failed');
  }
});

test('Cancellation uses existing PATCH, retains failures and moves success into cancelled history', async () => {
  for (const success of [false, true]) {
    let rows = [row('new')], error = '', closed = false;
    const ref = { current: false };
    const cancel = runFunction(extractFunction('cancelPreorder', 'updatePreorderYear'), 'cancelPreorder', {
      canEdit: true, preorderToCancel: rows[0], preorderCancelRequestRef: ref, operationalPreorderStatus,
      setCancellingPreorder: () => {}, setPreorderCancelError: value => error = value,
      clientRequest: async (url, init) => {
        assert.equal(url, '/api/preorders/1');
        assert.equal(init.method, 'PATCH');
        assert.deepEqual(JSON.parse(init.body), { status: 'cancelled' });
        return { ok: success, json: async () => success ? { preBooking: row('cancelled') } : { error: 'Failed' } };
      },
      setPreOrders: update => rows = update(rows), setNotice: () => {}, setPreorderToCancel: value => closed = value === null,
    });
    await cancel();
    assert.equal(matchesPreorderFilter(rows[0], 'active'), !success);
    assert.equal(matchesPreorderFilter(rows[0], 'cancelled'), success);
    assert.equal(closed, success);
    assert.equal(error, success ? '' : 'Failed');
    assert.equal(ref.current, false);
  }
});

test('GET filters converted statuses and booking-linked rows without deleting history', async () => {
  const { drizzle } = require('drizzle-orm/postgres-js');
  const schemaContext = { exports: {}, require };
  vm.runInNewContext(compile(readFileSync(new URL('../db/schema.ts', import.meta.url), 'utf8')), schemaContext);
  const schema = schemaContext.exports;
  const db = drizzle({});
  let query;
  const context = { exports: {}, Response, require: name => {
    if (name === 'drizzle-orm') return require(name);
    if (name === '../../../db/schema') return schema;
    if (name === '../../preorder-status') return statusModule.exports;
    if (name === '../../authz') return { requireRole: async roles => { assert.deepEqual(Array.from(roles), ['admin', 'operator']); return { user: { role: 'admin' } }; } };
    if (name === '../../../db') return { createRequestDiagnostics: () => ({ stage() {} }), getHealthyDb: async () => ({ select: () => ({ from: table => ({ where: condition => ({ orderBy: order => { query = db.select().from(table).where(condition).orderBy(order).toSQL(); return []; } }) }) }) }) };
    return {};
  } };
  vm.runInNewContext(compile(readFileSync(new URL('../app/api/preorders/route.ts', import.meta.url), 'utf8')), context);
  assert.equal((await context.exports.GET()).status, 200);
  assert.match(query.sql, /not in/);
  assert.match(query.sql, /converted_booking_id.*is null/);
  assert.deepEqual(query.params, ['converted', 'Үндсэн захиалга болсон']);
});

test('Conversion entry blocks terminal rows and unauthorized roles, and allows retry after returning to list', () => {
  const start = source.indexOf('  function convertPreorder(');
  const code = compile(source.slice(start, source.indexOf('  function changeView(', start)));
  for (const [status, canEdit, expected] of [['converted', true, false], ['cancelled', true, false], ['new', false, false], ['new', true, true]]) {
    let opened = false;
    const convert = runFunction(code, 'convertPreorder', {
      canEdit, operationalPreorderStatus, submitting: false, pendingPreorderId: 1,
      setPendingPreorderId: () => {}, setForm: () => {}, branches: ['branch'], iso: () => '2026-09-05',
      setNotice: () => {}, setView: () => opened = true, loadProducts: () => {},
    });
    convert(row(status));
    assert.equal(opened, expected);
  }
});
