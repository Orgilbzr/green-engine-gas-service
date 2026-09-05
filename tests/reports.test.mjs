import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import { db, model, GET, getQueryCount, setRole } from './report-fixture.mjs';
const require = createRequire(import.meta.url);
after(() => db.close());
const base = 'from=2026-09-01&to=2026-09-30';
async function report(extra = '') {
  const response = await GET(new Request(`http://localhost/api/reports?${base}${extra ? '&' + extra : ''}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

test('defaults use current month in Mongolia and parser validates every parameter', () => {
  const defaults = model.defaultReportFilters(new Date('2026-09-15T00:00:00Z'));
  assert.equal(defaults.from, '2026-09-01'); assert.equal(defaults.to, '2026-09-15');
  for (const input of ['from=2026-02-30', 'to=2026-08-01&from=2026-09-01', 'status=bad', 'productId=-1', 'productId=2.5', 'paymentStatus=bad', 'source=bad', 'page=0', 'format=csv', 'unknown=1', 'page=1&page=2', 'search=' + 'x'.repeat(101), 'from=']) {
    assert.throws(() => model.parseReportQuery(new URLSearchParams(input)), model.ReportValidationError);
  }
  assert.equal(model.parseReportQuery(new URLSearchParams('status=cancelled')).filters.status, 'Цуцлагдсан');
});

test('current month totals match all filtered rows, preserving final payments and cancelled records', async () => {
  const before = getQueryCount();
  const data = await report();
  assert.equal(getQueryCount() - before, 1, 'one database statement per request');
  assert.deepEqual(data.rows.map(row => row.id), [4,3,2,1]);
  assert.deepEqual(data.totals, { count: 4, sales: 17000000, advance: 3000000, remaining: 9000000, completed: 2, cancelled: 1 });
  assert.equal(data.branchSummary.reduce((sum, row) => sum + row.count, 0), 4);
  assert.equal(data.productSummary.reduce((sum, row) => sum + row.sales, 0), data.totals.sales);
  assert.equal(data.rows.find(row => row.id === 1).source, 'facebook', 'duplicate preorder links do not duplicate bookings');
});

test('branch, product, status, source, payments and literal searches filter in SQL', async () => {
  for (const [filter, ids] of [
    ['branch=' + encodeURIComponent('16-ын салбар'), [3,1]], ['productId=2', [2]],
    ['status=' + encodeURIComponent('Цуцлагдсан'), [3]], ['source=facebook', [1]],
    ['paymentStatus=advance', [2,1]], ['paymentStatus=remaining', [3,1]], ['paymentStatus=paid', [4,2]],
    ['search=GE-001', [1]], ['search=' + encodeURIComponent('1234УБА'), [1]],
    ['search=' + encodeURIComponent('1234 УБА'), [1]], ['search=' + encodeURIComponent('Саруул'), [2]], ['search=00112233', [1]],
    ['search=%25', []], ['search=%27%20OR%201%3D1--', []], ['productId=2&source=facebook', []],
  ]) {
    const data = await report(filter);
    assert.deepEqual(data.rows.map(row => row.id), ids, filter);
    assert.equal(data.totals.count, ids.length, filter);
    assert.equal(data.rows.reduce((sum, row) => sum + row.remaining, 0), data.totals.remaining, filter);
  }
  const response = await GET(new Request('http://localhost/api/reports?from=2026-09-02&to=2026-09-03'));
  assert.deepEqual((await response.json()).rows.map(row => row.id), [3,2]);
});

test('unauthorized roles cannot view or export, and invalid requests never query the database', async () => {
  const before = getQueryCount();
  for (const role of ['mechanic', 'unknown', '']) {
    setRole(role);
    for (const format of ['json', 'xlsx']) assert.equal((await GET(new Request(`http://localhost/api/reports?${base}&format=${format}`))).status, 403);
  }
  setRole('operator');
  assert.equal((await GET(new Request('http://localhost/api/reports?page=-1'))).status, 400);
  assert.equal(getQueryCount(), before);
  assert.equal((await report()).totals.count, 4);
  setRole('admin');
});

test('Excel contains exactly the filtered rows, two formatted sheets, frozen header and autofilter', async () => {
  const response = await GET(new Request(`http://localhost/api/reports?${base}&paymentStatus=paid&format=xlsx`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /green-engine-report-2026-09-01-2026-09-30.xlsx/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { unzipSync, strFromU8 } = createRequire(require.resolve('write-excel-file/node'))('fflate');
  const files = unzipSync(bytes);
  const xml = path => strFromU8(files[path]);
  const workbook = xml('xl/workbook.xml');
  assert.equal((workbook.match(/<sheet /g) || []).length, 2);
  assert.match(workbook, /Товч тайлан/); assert.match(workbook, /Захиалгын дэлгэрэнгүй/);
  const detail = xml('xl/worksheets/sheet2.xml');
  const strings = files['xl/sharedStrings.xml'] ? xml('xl/sharedStrings.xml') : detail;
  assert.match(strings, /GE-002/); assert.match(strings, /GE-004/);
  assert.doesNotMatch(strings, /GE-001|GE-003|GE-005|GE-006/);
  assert.equal((detail.match(/<row /g) || []).length, 3);
  assert.match(detail, /autoFilter ref="A1:O3"/);
  assert.match(detail, /state="frozen"/); assert.match(detail, /ySplit="1"/);
  assert.match(detail, /<c[^>]*r="B2"[^>]*><v>\d+(?:\.\d+)?<\/v><\/c>/, 'dates are numeric Excel cells');
  assert.match(detail, /<cols>/); assert.match(xml('xl/styles.xml'), /yyyy-mm-dd/);
  assert.match(xml('xl/styles.xml'), /#,##0.*₮/); assert.match(xml('xl/styles.xml'), /<b\s*\/>/);
  assert.doesNotMatch(detail, /<f[ >]/, 'user text cannot become a formula');
  assert.match(strings, /=1\+1/);
  assert.match(xml('xl/worksheets/sheet1.xml'), /7000000/);
  assert.match(detail, /6000000/);
  writeFileSync('/tmp/green-engine-report-test.xlsx', bytes);
});

test('detail pages are bounded but KPIs and Excel cover every matching record', async () => {
  await db.exec(`insert into bookings select n, 'PAGE-' || n, '2026-09-20', '09:00', 'Pagination', '00112233', 'TEST', 'Toyota', 2010, 'Test branch', 1, 'Газ 4', 100, 20, 10, 'Хүлээгдэж буй' from generate_series(100,160) n`);
  const first = await report('search=PAGE-');
  const second = await report('search=PAGE-&page=2');
  assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 11);
  assert.equal(first.totals.count, 61); assert.deepEqual(first.totals, second.totals);
  assert.equal(first.totals.remaining, 4270);
  const response = await GET(new Request(`http://localhost/api/reports?${base}&search=PAGE-&page=2&format=xlsx`));
  const { unzipSync, strFromU8 } = createRequire(require.resolve('write-excel-file/node'))('fflate');
  const xml = strFromU8(unzipSync(new Uint8Array(await response.arrayBuffer()))['xl/worksheets/sheet2.xml']);
  assert.equal((xml.match(/<row /g) || []).length, 62);
});


test('oversized exports return an explicit error instead of a truncated workbook', async () => {
  await db.exec(`insert into bookings select n, 'LIMIT-' || n, '2030-01-01', '09:00', 'Export cap', '', '', '', null, 'Test', null, '', 1, 0, 0, 'Хүлээгдэж буй' from generate_series(1000,51000) n`);
  const response = await GET(new Request('http://localhost/api/reports?from=2030-01-01&to=2030-01-01&format=xlsx'));
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /50,000/);
});
