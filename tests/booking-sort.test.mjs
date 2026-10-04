import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const cache = new Map();
function load(url) {
  if (cache.has(url)) return cache.get(url);
  const exportsObj = {};
  const req = name => name.startsWith('.') ? load(new URL(name.endsWith('.ts') ? name : `${name}.ts`, url).href) : require(name);
  new Function('exports', 'require', compile(readFileSync(fileURLToPath(url), 'utf8')))(exportsObj, req);
  cache.set(url, exportsObj);
  return exportsObj;
}
const { sortBookings, nextSort, progressPercent } = load(new URL('../app/booking-sort.ts', import.meta.url).href);
const { matchesBookingFilters } = load(new URL('../app/booking-filters.ts', import.meta.url).href);
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

const b = (id, o = {}) => ({ id, customer: `C${id}`, plate: `P${id}`, vehicle: 'Toyota', date: '2026-10-01', time: '10:00', totalPrice: 100, advance: 0, finalPaid: 0, ...o });
const ids = (rows, sort) => sortBookings(rows, sort).map(r => r.id);
const asc = key => ({ key, direction: 'asc' });
const desc = key => ({ key, direction: 'desc' });

test('header click cycles ascending, descending, none, and restarts on a new column', () => {
  const first = nextSort(null, 'customer');
  assert.deepEqual(first, asc('customer'));
  assert.deepEqual(nextSort(first, 'customer'), desc('customer'));
  assert.equal(nextSort(desc('customer'), 'customer'), null);
  assert.deepEqual(nextSort(null, 'customer'), asc('customer'));
  assert.deepEqual(nextSort(desc('customer'), 'payment'), asc('payment'));
  assert.deepEqual(nextSort(asc('customer'), 'payment'), asc('payment'));
});

test('returning to no sort restores the original order exactly', () => {
  const rows = [b(3, { customer: 'Z' }), b(1, { customer: 'A' }), b(2, { customer: 'M' })];
  const original = rows.map(r => r.id);
  let sort = nextSort(null, 'customer');
  assert.deepEqual(ids(rows, sort), [1, 2, 3]);
  sort = nextSort(sort, 'customer');
  assert.deepEqual(ids(rows, sort), [3, 2, 1]);
  sort = nextSort(sort, 'customer');
  assert.equal(sort, null);
  assert.deepEqual(ids(rows, sort), original);
});

test('customer sorts locale-aware and case-insensitively', () => {
  const rows = [b(1, { customer: 'bat' }), b(2, { customer: 'Aldar' }), b(3, { customer: 'Zorig' })];
  assert.deepEqual(ids(rows, asc('customer')), [2, 1, 3]);
  assert.deepEqual(ids(rows, desc('customer')), [3, 1, 2]);
});

test('vehicle sorts by model then plate', () => {
  const rows = [b(1, { vehicle: 'Toyota Prius', plate: '2222 ААА' }), b(2, { vehicle: 'Honda Fit', plate: '9999 ААА' }), b(3, { vehicle: 'Toyota Prius', plate: '1111 ААА' })];
  assert.deepEqual(ids(rows, asc('vehicle')), [2, 3, 1]);
  assert.deepEqual(ids(rows, desc('vehicle')), [1, 3, 2]);
});

test('schedule sorts by real date and time, not display text', () => {
  const rows = [b(1, { date: '2026-10-02', time: '09:00' }), b(2, { date: '2026-10-01', time: '15:00' }), b(3, { date: '2026-10-01', time: '09:00' })];
  assert.deepEqual(ids(rows, asc('schedule')), [3, 2, 1]);
  assert.deepEqual(ids(rows, desc('schedule')), [1, 2, 3]);
});

test('progress uses the existing 0/33/67/100 calculation, incomplete handover included', () => {
  const rows = [
    b(1, { programmingCompleted: true, installationCompleted: true, handoverCompleted: true }),
    b(2),
    b(3, { programmingCompleted: true }),
    b(4, { programmingCompleted: true, installationCompleted: true }),
    b(5, { handoverCompleted: true }),
  ];
  assert.deepEqual(rows.map(progressPercent), [100, 0, 33, 67, 33]);
  assert.deepEqual(ids(rows, asc('progress')), [2, 3, 5, 4, 1]);
  assert.deepEqual(ids(rows, desc('progress')), [1, 4, 3, 5, 2]);
});

test('payment sorts by outstanding balance clamped at zero', () => {
  const rows = [b(1, { totalPrice: 1000, advance: 100 }), b(2, { totalPrice: 500, advance: 500 }), b(3, { totalPrice: 100, advance: 300 }), b(4, { totalPrice: 400 })];
  assert.deepEqual(ids(rows, asc('payment')), [2, 3, 4, 1]);
  assert.deepEqual(ids(rows, desc('payment')), [1, 4, 2, 3]);
});

test('mechanic rows without amounts sort by the paid flag only', () => {
  const rows = [{ ...b(1), totalPrice: undefined, balancePaid: false }, { ...b(2), totalPrice: undefined, balancePaid: true }];
  assert.deepEqual(ids(rows, asc('payment')), [2, 1]);
});

test('ties fall back to id in both directions and the input is not mutated', () => {
  const rows = [b(3), b(1), b(2)];
  const snapshot = rows.map(r => r.id);
  assert.deepEqual(ids(rows, asc('progress')), [1, 2, 3]);
  assert.deepEqual(ids(rows, { key: 'progress', direction: 'desc' }), [1, 2, 3]);
  assert.deepEqual(rows.map(r => r.id), snapshot);
  assert.notEqual(sortBookings(rows, null), rows);
});

test('sorting applies after filters/search', () => {
  const rows = [b(1, { customer: 'B', programmingCompleted: true }), b(2, { customer: 'A' }), b(3, { customer: 'C', programmingCompleted: true })];
  const filtered = rows.filter(r => matchesBookingFilters(r, 'programming', '', 0));
  assert.deepEqual(ids(filtered, desc('customer')), [3, 1]);
});

test('registered sorts by the real timestamp, not formatted text, and cycles back to default', () => {
  const rows = [
    b(1, { createdAt: '2026-10-04T10:42:00.000Z' }),
    b(2, { createdAt: '2026-09-30T23:59:00.000Z' }),
    b(3, { createdAt: '2026-10-04T10:41:59.000Z' }),
    b(4, { createdAt: '2025-12-31T01:00:00.000Z' }),
  ];
  // Formatted "MM/DD" text would put 09/30 before 10/04 and 12/31 last; the real timestamp puts 2025 first.
  assert.deepEqual(ids(rows, asc('registered')), [4, 2, 3, 1]);
  assert.deepEqual(ids(rows, desc('registered')), [1, 3, 2, 4]);
  let sort = nextSort(null, 'registered');
  assert.deepEqual(sort, asc('registered'));
  sort = nextSort(sort, 'registered');
  assert.deepEqual(sort, desc('registered'));
  sort = nextSort(sort, 'registered');
  assert.equal(sort, null);
  assert.deepEqual(ids(rows, sort), [1, 2, 3, 4]);
});

test('registered ties and missing timestamps are deterministic and never inferred from booking fields', () => {
  const rows = [b(2, { createdAt: '2026-10-04T10:00:00.000Z', date: '2030-01-01' }), b(1, { createdAt: '2026-10-04T10:00:00.000Z', date: '2020-01-01' }), b(3, { createdAt: null, date: '2031-01-01' }), b(4, { date: '2019-01-01' })];
  assert.deepEqual(ids(rows, asc('registered')), [3, 4, 1, 2]);
  assert.deepEqual(ids(rows, desc('registered')), [1, 2, 3, 4]);
});

test('page wires sorting after filters and only six headers are sortable', () => {
  assert.match(page, /return sortBookings\(filtered, bookingSort\)/);
  for (const key of ['registered', 'customer', 'vehicle', 'schedule', 'progress', 'payment']) assert.match(page, new RegExp(`sortKey="${key}"`));
  assert.match(page, /<th>ТЭМДЭГЛЭЛ<\/th>/);
  assert.match(page, /\{editable && <th>ҮЙЛДЭЛ<\/th>\}/);
});
