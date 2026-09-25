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
const { hasBookingDeleteEvidence } = moduleFrom('../app/booking-delete.ts', {});
const table = name => ({ name, id: `${name}.id`, bookingId: `${name}.bookingId`,
  bookingNo: `${name}.bookingNo`, convertedBookingId: `${name}.convertedBookingId`,
  entityType: `${name}.entityType`, entityId: `${name}.entityId`, entityRef: `${name}.entityRef`, action: `${name}.action` });
const bookings = table('bookings'), preBookings = table('preBookings'), serviceVisits = table('serviceVisits');
const bookingNotes = table('bookingNotes'), auditLogs = table('auditLogs');
const clean = { id: 11, bookingNo: 'GE-11', status: 'Хүлээгдэж буй', advance: 0, finalPaid: 0, receipt: '', advanceType: null,
  advanceNote: '', programmingCompleted: false, installationCompleted: false,
  handoverCompleted: false, programmingCompletedAt: null, installationCompletedAt: null,
  handoverCompletedAt: null, programmingCompletedBy: null, installationCompletedBy: null,
  handoverCompletedBy: null, noteCount: 0, hasArrived: false };

function fixture({ booking = {}, visits = [], notes = [], preorders = [], audits = [], returned = false,
  returnedMarker = false, returnedLineage = false } = {}) {
  const queries = [], events = [];
  const row = { ...clean, ...booking };
  const tables = new Map([[bookings, [row]], [preBookings, preorders],
    [serviceVisits, visits], [bookingNotes, notes], [auditLogs, audits]]);
  const tx = {
    execute: async () => [{ retained: returnedMarker || returnedLineage }],
    select() {
      const query = { table: null, where: null };
      const builder = { from(value) { query.table = value; return this; }, where(value) { query.where = value; return this; },
        limit() { return this; }, for() { return this; },
        then(resolve, reject) { queries.push(query); const rows = tables.get(query.table) ?? [];
          return Promise.resolve(query.table === auditLogs ? rows.filter(item => item.action !== 'booking.created') : rows).then(resolve, reject); } };
      return builder;
    },
    delete() { events.push('delete'); return { where() { return this; }, returning: async () => [row] }; },
  };
  const db = { transaction: callback => callback(tx) };
  const { DELETE } = moduleFrom('../app/api/bookings/[id]/route.ts', {
    'drizzle-orm': { eq: (column, value) => ({ eq: [column, value] }),
      ne: (column, value) => ({ ne: [column, value] }),
      and: (...items) => ({ and: items }), or: (...items) => ({ or: items }),
      sql: () => ({ query: 'read-only lineage check' }) },
    '../../../../db': { getHealthyDb: async () => db, isDatabaseConnectionError: () => false,
      safeErrorResponse: () => Response.json({ error: 'unexpected' }, { status: 500 }) },
    '../../../../db/schema': { bookings, preBookings, serviceVisits, bookingNotes, auditLogs },
    '../../../../db/notes': { notesCondition: () => ({ allNotesIncludingDeleted: true }) },
    '../../../input-validation': { validId: Number, inputErrorResponse: () => null },
    '../../../request-origin': { checkRequestOrigin: () => null },
    '../../../authz': { requireRole: async roles => {
      assert.deepEqual(Array.from(roles), ['admin', 'operator']);
      return { user: { role: 'operator' } };
    } },
    '../../../audit': { writeAuditLog: async input => { events.push(input.action); } },
    '../../../../db/booking-capacity': {}, '../../../manufacture-year': { manufactureYearDatabaseError: () => null },
    '../../../operations-0015': { isReturnedBooking: async () => returned },
    '../../../booking-delete': { hasBookingDeleteEvidence },
  });
  const call = () => DELETE(new Request('http://local/api/bookings/11', { method: 'DELETE' }),
    { params: Promise.resolve({ id: '11' }) });
  return { call, queries, events };
}

test('unused booking remains hard deletable and records booking.deleted', async () => {
  const f = fixture({ audits: [{ id: 1, action: 'booking.created' }] });
  const response = await f.call();
  assert.equal(response.status, 200);
  assert.deepEqual(f.events, ['delete', 'booking.deleted']);
  const auditQuery = f.queries.find(q => q.table === auditLogs);
  assert.equal(JSON.stringify(auditQuery.where).includes('booking.created'), true);
  assert.equal(JSON.stringify(auditQuery.where).includes('auditLogs.entityRef'), true);
});

for (const [name, options] of [
  ['current service visit', { visits: [{ id: 1 }] }],
  ['programming completion', { booking: { programmingCompleted: true } }],
  ['installation completion', { booking: { installationCompleted: true } }],
  ['handover completion', { booking: { handoverCompleted: true } }],
  ['advance payment', { booking: { advance: 1 } }],
  ['final payment', { booking: { finalPaid: 1 } }],
  ['receipt', { booking: { receipt: 'receipt' } }],
  ['advance type', { booking: { advanceType: 'other' } }],
  ['advance note', { booking: { advanceNote: 'payment evidence' } }],
  ['returned marker', { returned: true }],
  ['returned marker when flag is off', { returnedMarker: true }],
  ['returned-from preorder lineage', { returnedLineage: true }],
  ['preorder lineage', { preorders: [{ id: 2 }] }],
  ['note history including soft-deleted note', { notes: [{ id: 3, deletedAt: new Date() }] }],
  ['historical audit after cleared service flag', { audits: [{ id: 4, action: 'booking.programming.reverted' }] }],
  ['unknown audit action', { audits: [{ id: 5, action: 'booking.unknown' }] }],
  ['old completion timestamp', { booking: { programmingCompletedAt: new Date() } }],
  ['completed status without flags', { booking: { status: 'Дууссан' } }],
]) {
  test(`${name} blocks direct DELETE with 409 and no write`, async () => {
    const f = fixture(options);
    const response = await f.call();
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /устгах боломжгүй/);
    assert.deepEqual(f.events, []);
  });
}

test('UI evidence helper hides deletion for known state and leaves clean row available', () => {
  assert.equal(hasBookingDeleteEvidence(clean), false);
  for (const booking of [
    { hasArrived: true }, { programmingCompleted: true }, { installationCompleted: true },
    { handoverCompleted: true }, { advance: 1 }, { finalPaid: 1 }, { receipt: 'receipt' },
    { advanceType: 'other' }, { advanceNote: 'paid' }, { noteCount: 1 }, { status: 'Дууссан' },
  ]) assert.equal(hasBookingDeleteEvidence({ ...clean, ...booking }), true);
});
