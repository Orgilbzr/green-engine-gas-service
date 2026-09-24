import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function moduleFrom(path, imports) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require: name => imports[name] ?? require(name), Response, crypto };
  vm.runInNewContext(code, context, { filename: path });
  return context.exports;
}
const sql = (parts, ...values) => ({ text: parts.join('?'), values });
const table = name => ({ table: name, id: { table: name, column: 'id' },
  convertedBookingId: { table: name, column: 'converted_booking_id' }, bookingNo: { table: name, column: 'booking_no' } });
const bookings = table('bookings'), preBookings = table('pre_bookings'), serviceVisits = table('service_visits');
const eq = (column, value) => ({ column, value });
function selectBuilder(resolve) {
  const state = { table: null, predicate: null };
  const builder = { from(value) { state.table = value; return this; }, where(value) { state.predicate = value; return this; },
    limit() { return this; }, for() { return this; }, then(success, failure) { return Promise.resolve(resolve(state)).then(success, failure); } };
  return builder;
}

test('note delete route allows admin/operator, rejects mechanic, and never issues physical DELETE', async () => {
  for (const role of ['admin','operator','mechanic']) {
    const calls = [];
    let notes = [{ id: 7, note: 'Original', createdAt: '2026-09-22', createdBy: { name: 'original' } }];
    const tx = { select: () => selectBuilder(() => [{ id: 1 }]),
      execute: async query => { calls.push(query); notes = []; return [{ id: 7 }]; } };
    const db = { transaction: async callback => callback(tx) };
    const { noteRoutes } = moduleFrom('../app/note-routes.ts', {
      'drizzle-orm': { eq, sql }, '../db': { getHealthyDb: async () => db, NO_STORE_HEADERS: {}, safeErrorResponse: () => Response.json({}, { status: 500 }) },
      '../db/schema': { bookings, preBookings }, '../db/notes': { appendNote() {}, readNotes: async () => notes },
      './authz': { requireRole: async allowed => allowed.includes(role) ? { user: { id: 2, name: role, email: `${role}@example.com`, role } } : { response: Response.json({}, { status: 403 }) } },
      './input-validation': { inputErrorResponse: () => null, readJsonObject: request => request.json(), validId: value => Number(value), text: String },
      './request-origin': { checkRequestOrigin: () => null },
      './operations-0015': { operations0015Enabled: async () => true, operationsUnavailable: () => Response.json({}, { status: 503 }) },
    });
    const route = noteRoutes('bookings');
    const response = await route.DELETE(new Request('http://local/api/bookings/1/notes',
      { method: 'DELETE', body: JSON.stringify({ noteId: 7 }) }), { params: Promise.resolve({ id: '1' }) });
    assert.equal(response.status, role === 'mechanic' ? 403 : 200);
    assert.equal(calls.length, role === 'mechanic' ? 0 : 1);
    if (role !== 'mechanic') {
      assert.match(calls[0].text, /update public\.booking_notes set/);
      assert.doesNotMatch(calls[0].text, /delete from/i);
      assert.deepEqual((await response.json()).notes, []);
    }
  }
});

test('note deletion stays unavailable on the old schema even to admin', async () => {
  const { noteRoutes } = moduleFrom('../app/note-routes.ts', {
    'drizzle-orm': { eq, sql }, '../db': { getHealthyDb: () => { throw Error('must not query'); } },
    '../db/schema': { bookings, preBookings }, '../db/notes': {},
    './authz': { requireRole: async () => ({ user: { role: 'admin' } }) },
    './input-validation': {}, './request-origin': { checkRequestOrigin: () => null },
    './operations-0015': { operations0015Enabled: async () => false, operationsUnavailable: () => Response.json({}, { status: 503 }) },
  });
  const response = await noteRoutes('bookings').DELETE(new Request('http://local', { method: 'DELETE' }),
    { params: Promise.resolve({ id: '1' }) });
  assert.equal(response.status, 503);
});

const { returnIneligibleReason } = moduleFrom('../app/booking-return.ts', {});
function returnFixture(overrides = {}, options = {}) {
  const booking = { id: 10, bookingNo: 'GE-10', customer: 'Customer', phone: '99112233', vehicle: 'Prius',
    plate: '1234УБА', manufactureYear: 2020, branch: '16-ын салбар', bookingDate: '2026-09-24', bookingTime: '09:00',
    status: 'Хүлээгдэж буй', advance: 0, finalPaid: 0, programmingCompleted: false,
    installationCompleted: false, handoverCompleted: false, ...overrides };
  const preorders = options.original === false ? [] : [{ id: 1, convertedBookingId: 10, source: 'website' }];
  const events = [], audits = [];
  let returned = false;
  const tx = {
    select: () => selectBuilder(({ table, predicate }) => {
      if (table === bookings) return [booking];
      if (table === serviceVisits) return options.visit ? [{ id: 80 }] : [];
      if (table === preBookings) return preorders.filter(p => predicate.column === preBookings.id ? p.id === predicate.value : p.convertedBookingId === predicate.value);
      return [];
    }),
    execute: async query => {
      events.push(query.text);
      if (query.text.includes('select returned_to_preorder_at')) return [{ returned: returned ? new Date() : null }];
      if (query.text.includes('select id from public.pre_bookings where returned_from_booking_id'))
        return preorders.filter(p => p.returnedFromBookingId === 10).map(p => ({ id: p.id }));
      if (query.text.includes('insert into public.pre_bookings')) {
        const created = { id: 2, convertedBookingId: null, returnedFromBookingId: 10,
          parentPreBookingId: preorders[0]?.id ?? null, source: preorders[0]?.source ?? 'manual' };
        preorders.push(created); return [{ id: 2 }];
      }
      if (query.text.includes('update public.bookings')) { booking.status = 'cancelled'; returned = true; return [{ returnedAt: new Date('2026-09-24T00:00:00.000Z') }]; }
      throw Error(`Unexpected SQL: ${query.text}`);
    },
  };
  let queue = Promise.resolve();
  const db = { transaction(callback) { const task = queue.then(() => callback(tx)); queue = task.catch(() => undefined); return task; } };
  const { POST } = moduleFrom('../app/api/bookings/[id]/return-to-preorder/route.ts', {
    'drizzle-orm': { eq, sql }, '../../../../../db': { getHealthyDb: async () => db, safeErrorResponse: () => Response.json({}, { status: 500 }) },
    '../../../../../db/schema': { bookings, preBookings, serviceVisits },
    '../../../../../db/notes': { withNoteSummaries: async (_db, _kind, rows) => rows },
    '../../../../authz': { requireRole: async () => ({ user: { id: 2, role: 'operator', email: 'operator@example.com' } }) },
    '../../../../audit': { writeAuditLog: async input => { audits.push(input); events.push('audit'); } },
    '../../../../booking-return': { returnIneligibleReason },
    '../../../../input-validation': { validId: Number, inputErrorResponse: () => null },
    '../../../../operations-0015': { operations0015Enabled: async () => true, operationsUnavailable: () => Response.json({}, { status: 503 }) },
    '../../../../request-origin': { checkRequestOrigin: () => null },
  });
  const call = () => POST(new Request('http://local', { method: 'POST' }), { params: Promise.resolve({ id: '10' }) });
  return { booking, preorders, audits, events, call };
}

test('return route preserves A, creates linked B, marks booking inactive and audits atomically', async () => {
  const fixture = returnFixture();
  const response = await fixture.call();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).preBooking.id, 2);
  assert.equal(fixture.preorders[0].convertedBookingId, 10);
  assert.deepEqual({ parent: fixture.preorders[1].parentPreBookingId, returnedFrom: fixture.preorders[1].returnedFromBookingId },
    { parent: 1, returnedFrom: 10 });
  assert.equal(fixture.booking.status, 'cancelled');
  assert.equal(fixture.audits.length, 1);
  assert.equal(fixture.audits[0].details.target_preorder_id, 2);
  assert.equal(fixture.audits[0].details.returned_at.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.ok(fixture.events.findIndex(e => e.includes('insert into public.pre_bookings')) < fixture.events.findIndex(e => e.includes('update public.bookings')));
  assert.equal(fixture.events.at(-1), 'audit');
});

test('direct booking return uses no parent; repeated and concurrent submissions create one preorder', async () => {
  const fixture = returnFixture({}, { original: false });
  const responses = await Promise.all([fixture.call(), fixture.call()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
  assert.equal(fixture.preorders.length, 1);
  assert.equal(fixture.preorders[0].parentPreBookingId, null);
  assert.equal(fixture.audits.length, 1);
});

test('each ineligible return has no insert, booking update or audit', async () => {
  const cases = [{ advance: 1 }, { finalPaid: 1 }, { programmingCompleted: true },
    { installationCompleted: true }, { handoverCompleted: true }, { status: 'cancelled' }];
  for (const candidate of cases) {
    const fixture = returnFixture(candidate);
    assert.equal((await fixture.call()).status, 409);
    assert.equal(fixture.preorders.length, 1);
    assert.equal(fixture.audits.length, 0);
    assert.ok(fixture.events.every(event => !event.includes('insert into public.pre_bookings')));
  }
  const withVisit = returnFixture({}, { visit: true });
  assert.equal((await withVisit.call()).status, 409);
  assert.equal(withVisit.audits.length, 0);
  const withoutYear = returnFixture({ manufactureYear: null }, { original: false });
  assert.equal((await withoutYear.call()).status, 409);
  assert.equal(withoutYear.audits.length, 0);
});

test('returned booking rejects every process mutation before service or visit writes', async () => {
  const updates = [];
  const tx = { select: () => selectBuilder(() => [{ id: 10, bookingNo: 'GE-10' }]),
    update: () => { updates.push('booking'); throw Error('unexpected update'); },
    insert: () => { updates.push('visit'); throw Error('unexpected insert'); },
    delete: () => { updates.push('visit delete'); throw Error('unexpected delete'); } };
  const db = { transaction: async callback => callback(tx) };
  const { PATCH } = moduleFrom('../app/api/bookings/[id]/process/route.ts', {
    'drizzle-orm': { eq }, '../../../../../db': { getHealthyDb: async () => db, NO_STORE_HEADERS: {}, safeErrorResponse: () => Response.json({}, { status: 500 }) },
    '../../../../../db/schema': { bookings, serviceVisits },
    '../../../../authz': { requireRole: async () => ({ user: { role: 'operator' } }) },
    '../../../../audit': { writeAuditLog: () => { throw Error('unexpected audit'); } },
    '../../../../request-origin': { checkRequestOrigin: () => null },
    '../../../../input-validation': { readJsonObject: request => request.json(), validId: Number,
      enumValue: value => value, inputErrorResponse: () => null },
    '../../../../service-process': { processSteps: ['programming','installation','handover'], purposeLabels: {} },
    '../../../../operations-0015': { isReturnedBooking: async () => true,
      returnedBookingConflict: () => Response.json({}, { status: 409 }) },
  });
  for (const body of [
    { action: 'step', step: 'programming', completed: true },
    { action: 'step', step: 'installation', completed: true },
    { action: 'step', step: 'handover', completed: true },
    { action: 'visit.add', date: '2026-09-24', time: '09:00', purpose: 'other', branch: '16-ын салбар' },
  ]) {
    const response = await PATCH(new Request('http://local', { method: 'PATCH', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: '10' }) });
    assert.equal(response.status, 409);
  }
  assert.deepEqual(updates, []);
});

test('returned booking rejects reschedule/payment and historical booking rejects hard delete', async () => {
  let mutated = false;
  const tx = {
    select: () => selectBuilder(({ table }) => table === bookings ? [{ id: 10, bookingNo: 'GE-10', status: 'cancelled' }]
      : table === preBookings ? [{ id: 1 }] : []),
    update: () => { mutated = true; throw Error('unexpected update'); },
    delete: () => { mutated = true; throw Error('unexpected delete'); },
  };
  const db = { transaction: async callback => callback(tx) };
  const { PATCH, DELETE } = moduleFrom('../app/api/bookings/[id]/route.ts', {
    'drizzle-orm': { eq }, '../../../../db': { getHealthyDb: async () => db, safeErrorResponse: () => Response.json({}, { status: 500 }), isDatabaseConnectionError: () => false },
    '../../../../db/schema': { bookings, preBookings, serviceVisits, bookingNotes: table('booking_notes') },
    '../../../../db/notes': { notesCondition: () => ({}) },
    '../../../input-validation': { readValidatedBody: request => request.json(), validId: Number, inputErrorResponse: () => null },
    '../../../request-origin': { checkRequestOrigin: () => null },
    '../../../authz': { requireRole: async () => ({ user: { role: 'operator' } }) },
    '../../../audit': { createChangeSet: () => ({}), writeAuditLog: () => { throw Error('unexpected audit'); } },
    '../../../../db/booking-capacity': { withBookingCapacity: (_db, callback) => callback(tx) },
    '../../../manufacture-year': { manufactureYearDatabaseError: () => null },
    '../../../operations-0015': { isReturnedBooking: async () => true,
      returnedBookingConflict: () => Response.json({}, { status: 409 }) },
  });
  const context = { params: Promise.resolve({ id: '10' }) };
  assert.equal((await PATCH(new Request('http://local', { method: 'PATCH', body: JSON.stringify({ finalPaid: 1 }) }), context)).status, 409);
  assert.equal((await PATCH(new Request('http://local', { method: 'PATCH', body: JSON.stringify({ date: '2026-09-25' }) }), context)).status, 409);
  assert.equal((await DELETE(new Request('http://local', { method: 'DELETE' }), context)).status, 409);
  assert.equal(mutated, false);
});

test('legacy preorder conversion rejects non-null link regardless of status', async () => {
  const { POST } = moduleFrom('../app/api/preorders/[id]/route.ts', {
    'drizzle-orm': { eq }, '../../../../db': { createRequestDiagnostics: () => ({ stage() {} }),
      getHealthyDb: async () => ({ select: () => selectBuilder(() =>
        [{ id: 1, status: 'cancelled', convertedBookingId: 10 }]) }) },
    '../../../../db/schema': { preBookings },
    '../../../input-validation': { validId: Number, readValidatedBody: async () => ({}), inputErrorResponse: () => null },
    '../../../request-origin': { checkRequestOrigin: () => null },
    '../../../authz': { requireRole: async () => ({ user: { role: 'operator' } }) },
    '../../../audit': {}, '../../../manufacture-year': {}, '../../../../db/booking-capacity': {},
    '../../../booking-duplicates': {}, '../../../../db/notes': {},
  });
  const response = await POST(new Request('http://local', { method: 'POST', body: '{}' }),
    { params: Promise.resolve({ id: '1' }) });
  assert.equal(response.status, 409);
});
