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
const { dashboardMetrics, balance } = load(read('app/dashboard-metrics.ts'), { './input-validation': validation });
const page = read('app/page.tsx');
const css = read('app/globals.css');
const booking = (overrides = {}) => ({
  status: 'Хүлээгдэж буй', date: '2025-01-01', branch: '16-ын салбар',
  programmingCompleted: false, installationCompleted: false, handoverCompleted: false,
  totalPrice: 1_000_000, advance: 200_000, finalPaid: 300_000,
  ...overrides,
});
const queues = rows => {
  const { programmingPending, installationPending, workPending } = dashboardMetrics(rows);
  return [programmingPending, installationPending, workPending];
};

test('work pending intentionally includes the two single-step queues; handover does not hide incomplete work; inactive bookings are excluded', () => {
  for (const [flags, expected] of [
    [{}, [0,0,1]], [{programmingCompleted:true}, [0,1,1]],
    [{installationCompleted:true}, [1,0,1]],
    [{programmingCompleted:true,installationCompleted:true}, [0,0,0]],
    [{programmingCompleted:null,installationCompleted:null}, [0,0,1]],
  ]) {
    assert.deepEqual(queues([booking(flags)]), expected);
    assert.deepEqual(queues([booking({...flags,handoverCompleted:true})]), expected);
    for (const status of ['Цуцлагдсан','cancelled','new']) assert.deepEqual(queues([booking({...flags,status})]), [0,0,0]);
    assert.deepEqual(queues([booking({...flags,returnedToPreorderAt:'2026-10-01'})]), [0,0,0]);
  }
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
  assert.equal(dashboardMetrics([booking(), booking({ finalPaid: 2_000_000 })]).outstandingCount, 1);
});

test('dashboard cards use summary response and expose retry on summary failure', () => {
  assert.doesNotMatch(page, /dashboardMetrics\(bookings\)/);
  assert.ok(page.includes("/api/dashboard-summary?"));
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
  const loadSummary = new Function('summaryRequestRef', 'setSummaryStatus', 'setDashboardSummary', 'fetchWithTimeout', 'AbortController', 'Symbol', 'console', 'dashboardBranchRef',
    `${compile(page.slice(start, end))}; return loadDashboardSummary;`)(
      requestRef, value => statuses.push(value), value => values.push(value),
      async (url) => {
        assert.equal(url, '/api/dashboard-summary?branch=');
        requests++;
        if (fail) throw Error('Unavailable');
        return { programmingPending: 2, installationPending: 3, workPending: 1, outstandingBalance: 900, outstandingCount: 2 };
      }, AbortController, Symbol, { error() {} }, { current: "" },
    );
  await loadSummary();
  assert.deepEqual(statuses, ['loading', 'error']);
  assert.deepEqual(values, [null]);
  fail = false;
  await loadSummary();
  assert.deepEqual(statuses, ['loading', 'error', 'loading', 'loaded']);
  assert.equal(values.at(-1).outstandingBalance, 900);
  assert.equal(values.at(-1).outstandingCount, 2);
  assert.equal(requests, 2);
});

test('rapid summary refresh aborts the older request and ignores its late result', async () => {
  const start = page.indexOf('  const loadDashboardSummary = async ');
  const end = page.indexOf('  const reload = async ', start);
  const requestRef = { current: null };
  const statuses = [], values = [], signals = [], resolves = [];
  const loadSummary = new Function('summaryRequestRef', 'setSummaryStatus', 'setDashboardSummary', 'fetchWithTimeout', 'AbortController', 'Symbol', 'console', 'dashboardBranchRef',
    `${compile(page.slice(start, end))}; return loadDashboardSummary;`)(
      requestRef, value => statuses.push(value), value => values.push(value),
      (_url, signal) => {
        signals.push(signal);
        return new Promise(resolve => resolves.push(resolve));
      }, AbortController, Symbol, { error() {} }, { current: "" },
    );
  const first = loadSummary();
  const second = loadSummary();
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  resolves[1]({ programmingPending: 2, installationPending: 1, workPending: 0, outstandingBalance: 100, outstandingCount: 1 });
  await second;
  resolves[0]({ programmingPending: 999, installationPending: 999, workPending: 999, outstandingBalance: 999, outstandingCount: 999 });
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

test('invalid or incomplete financial count responses become errors; redacted mechanic summary remains valid', async () => {
  const start = page.indexOf('  const loadDashboardSummary = async ');
  const end = page.indexOf('  const reload = async ', start);
  const queues = { programmingPending: 1, installationPending: 2, workPending: 3 };
  for (const [financial, expectedStatus] of [
    [{ outstandingBalance: 100, outstandingCount: -1 }, 'error'],
    [{ outstandingBalance: 100, outstandingCount: 1.5 }, 'error'],
    [{ outstandingBalance: 100, outstandingCount: '1' }, 'error'],
    [{ outstandingBalance: 100, outstandingCount: Number.MAX_SAFE_INTEGER + 1 }, 'error'],
    [{ outstandingBalance: 100, outstandingCount: null }, 'error'],
    [{ outstandingBalance: 100 }, 'error'],
    [{ outstandingCount: 1 }, 'error'],
    [{}, 'loaded'],
  ]) {
    const statuses = [], values = [];
    const summary = { ...queues, ...financial };
    const loadSummary = new Function('summaryRequestRef', 'setSummaryStatus', 'setDashboardSummary', 'fetchWithTimeout', 'AbortController', 'Symbol', 'console', 'dashboardBranchRef',
      `${compile(page.slice(start, end))}; return loadDashboardSummary;`)(
        { current: null }, value => statuses.push(value), value => values.push(value),
        async () => summary, AbortController, Symbol, { error() {} }, { current: "" },
      );
    await loadSummary();
    assert.deepEqual(statuses, ['loading', expectedStatus]);
    assert.deepEqual(values, [expectedStatus === 'error' ? null : summary]);
  }
});

test('four cards preserve colors, render counts, and dispatch the matching queue', () => {
  const start = page.indexOf('<section className="stats"');
  const section = page.slice(start, page.indexOf('</section>', start) + 10);
  const source = compile(`const element = (${section});`, ts.JsxEmit.React);
  const render = new Function('React', 'Stat', 'summaryStatus', 'dashboardSummary', 'openDashboardQueue', `const money = new Intl.NumberFormat("mn-MN"); ${source}; return element;`);
  const calls = [];
  const summary = { programmingPending: 12, installationPending: 34, workPending: 56, advanceUnpaid: 78, outstandingCount: 29, outstandingBalance: 146300000 };
  const element = render(React, props => React.createElement('article', {className: props.t}, React.createElement('button', {onClick:props.onClick}, props.l), React.createElement('strong', null, props.v), React.createElement('small', null, props.n)), 'loaded', summary, queue => calls.push(queue));
  const html = renderToStaticMarkup(element);
  assert.deepEqual([...html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]), ['34','12','56','78']);
  assert.deepEqual(element.props.children.map(card => card.props.l), ['Төхөөрөмж тавиагүй','Программ суулгаагүй','Аль нэг ажил дутуу','Урьдчилгаа төлөөгүй']);
  assert.deepEqual(element.props.children.map(card => card.props.t), ['blue','green','violet','amber']);
  assert.equal(element.props.children[0].props.n, 'Программ уншуулсан');
  assert.equal(element.props.children[1].props.n, 'Төхөөрөмж тавиулсан');
  assert.equal(element.props.children[2].props.n, 'Программ эсвэл төхөөрөмжийн ажил дутуу');
  assert.ok(html.includes('Төлбөрийн үлдэгдэлтэй: 29 машин'));
  assert.ok(html.includes('Нийт үлдэгдэл: 146,300,000₮'));
  const footer = (status, value) => renderToStaticMarkup(render(React, props => React.createElement('small', null, props.n), status, value, () => {}));
  const zero = footer('loaded', {...summary, outstandingCount:0, outstandingBalance:0});
  assert.ok(zero.includes('Төлбөрийн үлдэгдэлтэй: 0 машин'));
  assert.ok(zero.includes('Нийт үлдэгдэл: 0₮'));
  const anotherBranch = footer('loaded', {...summary, outstandingCount:3, outstandingBalance:1250500});
  assert.ok(anotherBranch.includes('Төлбөрийн үлдэгдэлтэй: 3 машин'));
  assert.ok(anotherBranch.includes('Нийт үлдэгдэл: 1,250,500₮'));
  for (const status of ['loading','idle','error']) {
    const pending = footer(status, summary);
    assert.ok(pending.includes('Төлбөрийн үлдэгдэлтэй: —'));
    assert.ok(pending.includes('Нийт үлдэгдэл: —'));
    assert.ok(!pending.includes('146,300,000'));
  }
  const redacted = footer('loaded', {programmingPending:1,installationPending:1,workPending:1});
  assert.ok(redacted.includes('Нийт үлдэгдэл: —'));
  element.props.children.forEach(card => card.props.onClick());
  assert.deepEqual(calls, ['programmed-not-installed','installed-not-programmed','work-pending','advance-unpaid']);
  const loading = renderToStaticMarkup(render(React, props => React.createElement('strong', null, props.v), 'loading', null, () => {}));
  assert.equal([...loading.matchAll(/<strong>—<\/strong>/g)].length, 4);
  for (const label of ['Программ суулгаагүй','Төхөөрөмж тавиагүй','Аль нэг ажил дутуу','Урьдчилгаа төлөөгүй']) assert.ok(html.includes(label));
});

test('zero total paid includes zero-price bookings and excludes any partial payment or unknown legacy amounts', () => {
  for (const [payments, expected] of [
    [{advance:0,finalPaid:0},1], [{advance:0,finalPaid:1},0], [{advance:1,finalPaid:0},0],
    [{advance:0,finalPaid:0,totalPrice:0},1], [{advance:null,finalPaid:0},0], [{advance:0,finalPaid:null},0],
  ]) assert.equal(dashboardMetrics([booking(payments)]).advanceUnpaid, expected);
});
