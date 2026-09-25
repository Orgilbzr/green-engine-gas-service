import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = (source, jsx = ts.JsxEmit.None) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx },
}).outputText;
function load(source, dependencies = {}) {
  const exports = {};
  new Function('exports', 'require', compile(source))(exports, name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}
const validation = load(read('app/input-validation.ts'), { './manufacture-year': {} });
const { dashboardMetrics, balance, isActiveBooking } = load(read('app/dashboard-metrics.ts'), { './input-validation': validation });
const page = read('app/page.tsx');
const css = read('app/globals.css');
const booking = (overrides = {}) => ({
  status: 'Хүлээгдэж буй', date: '2025-01-01', branch: '16-ын салбар',
  programmingCompleted: false, installationCompleted: false, handoverCompleted: false,
  totalPrice: 1_000_000, advance: 200_000, finalPaid: 300_000,
  ...overrides,
});
const queues = rows => {
  const { programmingPending, installationPending, handoverPending } = dashboardMetrics(rows);
  return [programmingPending, installationPending, handoverPending];
};

test('process flags create independent service queues regardless of booking date or arrival', () => {
  for (const [flags, expected] of [
    [{}, [1, 1, 1]],
    [{ programmingCompleted: true }, [0, 1, 1]],
    [{ installationCompleted: true }, [1, 0, 1]],
    [{ programmingCompleted: true, installationCompleted: true }, [0, 0, 1]],
    [{ programmingCompleted: true, installationCompleted: true, handoverCompleted: true }, [0, 0, 0]],
  ]) {
    assert.deepEqual(queues([booking(flags)]), expected);
    assert.deepEqual(queues([booking({ ...flags, hasArrived: true, date: '2020-01-01', branch: 'Нарны замын салбар' })]), expected);
  }
});

test('handover pending depends only on handover completion, including NULL', () => {
  for (const [programmingCompleted, installationCompleted, handoverCompleted, expected] of [
    [false, false, false, 1],
    [true, false, false, 1],
    [false, true, false, 1],
    [true, true, false, 1],
    [false, false, true, 0],
    [true, true, true, 0],
    [true, false, null, 1],
  ]) {
    assert.equal(dashboardMetrics([booking({ programmingCompleted, installationCompleted, handoverCompleted })]).handoverPending, expected);
  }
});

test('abnormal completed handover never enters handover waiting queue', () => {
  assert.deepEqual(queues([booking({ handoverCompleted: true })]), [1, 1, 0]);
  assert.deepEqual(queues([booking({ programmingCompleted: true, handoverCompleted: true })]), [0, 1, 0]);
  assert.deepEqual(queues([booking({ installationCompleted: true, handoverCompleted: true })]), [1, 0, 0]);
  assert.match(read('app/booking-filters.ts'), /"incomplete-handover": handover && \(!programming \|\| !installation\)/);
});

test('all supported active statuses count; cancelled, returned, and unknown statuses do not', () => {
  for (const status of ['Хүлээгдэж буй', 'Баталгаажсан', 'Суурилуулж байна', 'Дууссан']) {
    assert.deepEqual(queues([booking({ status })]), [1, 1, 1]);
  }
  for (const status of ['Цуцлагдсан', 'cancelled', 'new', 'unknown']) {
    assert.deepEqual(queues([booking({ status })]), [0, 0, 0]);
  }
  assert.deepEqual(queues([booking({ returnedToPreorderAt: new Date() })]), [0, 0, 0]);
  assert.match(read('app/api/bookings/route.ts'), /operations0015Enabled\(\) \? sql`returned_to_preorder_at is null`/);
  assert.equal(isActiveBooking(booking({ status: 'cancelled' })), false);
});

test('one untouched booking appears in both independent queues only once each', () => {
  assert.deepEqual(queues([booking()]), [1, 1, 1]);
  assert.deepEqual(queues([booking(), booking({ installationCompleted: true })]), [2, 1, 2]);
});

test('collectible balance keeps the existing clamped payment formula and excludes inactive records', () => {
  assert.equal(balance(booking()), 500_000);
  assert.equal(balance(booking({ finalPaid: 2_000_000 })), 0);
  assert.equal(dashboardMetrics([
    booking(),
    booking({ status: 'Цуцлагдсан', totalPrice: 9_000_000, advance: 0, finalPaid: 0 }),
    booking({ status: 'cancelled', totalPrice: 9_000_000, advance: 0, finalPaid: 0 }),
    booking({ returnedToPreorderAt: '2026-09-24T00:00:00Z', totalPrice: 9_000_000, advance: 0, finalPaid: 0 }),
  ]).outstandingBalance, 500_000);
});

test('dashboard renders the exact four labels, order, integer counts, and MNT formatted balance', () => {
  const start = page.indexOf('<section className="stats"');
  assert.notEqual(start, -1);
  const section = page.slice(start, page.indexOf('</section>', start) + 10);
  const code = ts.transpileModule(`const element = (${section});`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const dashboardSummary = dashboardMetrics([booking()]);
  const money = new Intl.NumberFormat('mn-MN');
  const render = (summaryStatus, summary) => new Function('React', 'Stat', 'money', 'summaryStatus', 'dashboardSummary', `${code}; return element;`)(
    React, ({ l, v, n }) => React.createElement('article', null, React.createElement('p', null, l), React.createElement('strong', null, v), React.createElement('small', null, n)),
    money, summaryStatus, summary,
  );
  const html = renderToStaticMarkup(render('loaded', dashboardSummary));
  const labels = [...html.matchAll(/<p>(.*?)<\/p>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Программ уншуулаагүй', 'Төхөөрөмж тавиулаагүй', 'Хүлээлгэн өгөөгүй', 'Авах үлдэгдэл']);
  assert.deepEqual([...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]),
    ['1', '1', '1', `${money.format(500_000)}₮`]);
  assert.match(html, /Ажил дуусахад авна/);
  for (const status of ['idle', 'loading', 'error']) {
    assert.deepEqual([...renderToStaticMarkup(render(status, null)).matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]),
      ['—', '—', '—', '—']);
  }
  const zeroHtml = renderToStaticMarkup(render('loaded', {
    programmingPending: 0, installationPending: 0, handoverPending: 0, outstandingBalance: 0,
  }));
  assert.deepEqual([...zeroHtml.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]), ['0', '0', '0', '0₮']);
});

test('dashboard cards use summary response and expose retry on summary failure', () => {
  assert.doesNotMatch(page, /dashboardMetrics\(bookings\)/);
  assert.match(page, /fetchWithTimeout\("\/api\/dashboard-summary", controller\.signal\)/);
  assert.match(page, /summaryStatus === "error" &&\s*<ResourceNotice[^>]*onRetry=\{\(\) => void loadDashboardSummary\(\)\}/);
  assert.match(page, /setBookings\(bookingData\.bookings \|\| \[\]\)/);
  assert.match(read('app/api/bookings/route.ts'), /\.limit\(500\)/);
  assert.ok(page.indexOf('Promise.resolve().then(() => loadDashboardSummary(controller.signal))') <
    page.indexOf('const result = await runDashboardStartup'));
});

test('summary request failure shows error, and a manual retry loads real values', async () => {
  const start = page.indexOf('  const loadDashboardSummary = async ');
  const end = page.indexOf('  const reload = async ', start);
  assert.ok(start >= 0 && end > start);
  const requestRef = { current: null };
  const statuses = [], values = [];
  let fail = true, requests = 0;
  const loadSummary = new Function('summaryRequestRef', 'setSummaryStatus', 'setDashboardSummary', 'fetchWithTimeout', 'AbortController', 'Symbol', 'console',
    `${compile(page.slice(start, end))}; return loadDashboardSummary;`)(
      requestRef, value => statuses.push(value), value => values.push(value),
      async (url) => {
        assert.equal(url, '/api/dashboard-summary');
        requests++;
        if (fail) throw Error('Unavailable');
        return { programmingPending: 2, installationPending: 3, handoverPending: 1, outstandingBalance: 900 };
      }, AbortController, Symbol, { error() {} },
    );
  await loadSummary();
  assert.deepEqual(statuses, ['loading', 'error']);
  assert.deepEqual(values, [null]);
  fail = false;
  await loadSummary();
  assert.deepEqual(statuses, ['loading', 'error', 'loading', 'loaded']);
  assert.equal(values.at(-1).outstandingBalance, 900);
  assert.equal(requests, 2);
});

test('rapid summary refresh aborts the older request and ignores its late result', async () => {
  const start = page.indexOf('  const loadDashboardSummary = async ');
  const end = page.indexOf('  const reload = async ', start);
  const requestRef = { current: null };
  const statuses = [], values = [], signals = [], resolves = [];
  const loadSummary = new Function('summaryRequestRef', 'setSummaryStatus', 'setDashboardSummary', 'fetchWithTimeout', 'AbortController', 'Symbol', 'console',
    `${compile(page.slice(start, end))}; return loadDashboardSummary;`)(
      requestRef, value => statuses.push(value), value => values.push(value),
      (_url, signal) => {
        signals.push(signal);
        return new Promise(resolve => resolves.push(resolve));
      }, AbortController, Symbol, { error() {} },
    );
  const first = loadSummary();
  const second = loadSummary();
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  resolves[1]({ programmingPending: 2, installationPending: 1, handoverPending: 0, outstandingBalance: 100 });
  await second;
  resolves[0]({ programmingPending: 999, installationPending: 999, handoverPending: 999, outstandingBalance: 999 });
  await first;
  assert.deepEqual(statuses, ['loading', 'loading', 'loaded']);
  assert.equal(values.length, 1);
  assert.equal(values[0].programmingPending, 2);
});

test('responsive grid and mechanic finance restriction remain usable with three queue cards', () => {
  assert.match(css, /\.stats\{display:grid;grid-template-columns:repeat\(4,1fr\)/);
  assert.match(css, /@media \(max-width:1100px\)\{\.mechanic-view \.stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.mechanic-view \.stat\.amber\{display:none\}\.mechanic-view \.stats\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.stat p\{[^}]*white-space:normal/);
});
