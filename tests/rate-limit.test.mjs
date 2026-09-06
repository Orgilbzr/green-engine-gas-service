import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const compiled = file => ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const helperCode = compiled('app/rate-limit.ts');
const routeCode = compiled('app/api/auth/login/route.ts');
const context = { route: 'POST /api/auth/login', requestId: 'synthetic-request' };
const message = 'Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.';

// TEST ONLY: shared REST contract double. No application code imports this store.
function backend() {
  const buckets = new Map();
  const calls = [];
  let now = 1000000;
  let mode = 'ok';
  const fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (mode === 'hang') return new Promise(() => {});
    if (mode === 'error') throw new Error('SENSITIVE_BACKEND_ERROR');
    if (mode === 'http') return Response.json({ error: 'SENSITIVE_BACKEND_ERROR' }, { status: 500 });
    if (mode === 'malformed') return Response.json({ result: ['unexpected'] });
    if (mode === 'body-hang') return { ok: true, json: () => new Promise(() => {}) };
    const [command, ...args] = JSON.parse(options.body);
    if (command === 'ZREM') return Response.json({ result: buckets.get(args[0])?.delete(args[1]) ? 1 : 0 });
    assert.equal(command, 'EVAL');
    const [, keyCount, key, window, limit, member] = args;
    assert.equal(keyCount, 1);
    const bucket = buckets.get(key) || new Map();
    buckets.set(key, bucket);
    for (const [id, at] of bucket) if (at <= now - window) bucket.delete(id);
    if (bucket.size >= limit) return Response.json({ result: [0, Math.max(1, Math.ceil((Math.min(...bucket.values()) + window - now) / 1000))] });
    bucket.set(member, now);
    return Response.json({ result: [1, 0] });
  };
  return { fetch, calls, buckets, advance: ms => { now += ms; }, mode: value => { mode = value; } };
}
function instance(store = backend(), overrides = {}) {
  const env = { NODE_ENV: 'production', VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://synthetic.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic-rest-token-only', ...overrides };
  const logs = [];
  const helper = {};
  new Function('exports', 'require', 'process', 'fetch', 'console', helperCode)(helper, require, { env }, store.fetch, { info: (...args) => logs.push(args) });
  let verifyCalls = 0;
  const route = {};
  const routeRequire = name => {
    if (name.endsWith('/request-origin')) return { checkRequestOrigin: () => null };
    if (name.endsWith('/rate-limit')) return helper;
    if (name.endsWith('/email-auth')) return { normalizeEmail: value => value.trim().toLowerCase(), loginWithPassword: async (_, password) => { verifyCalls++; return password === 'synthetic-correct-password'; } };
    if (name.endsWith('/auth-errors')) return { authErrorResponse: () => Response.json({ error: 'generic failure' }, { status: 503 }) };
    if (name.endsWith('/db')) return { createRequestDiagnostics: () => ({ ...context, stage() {} }), NO_STORE_HEADERS: { 'Cache-Control': 'no-store' } };
    throw new Error('Unexpected dependency');
  };
  new Function('exports', 'require', routeCode)(route, routeRequire);
  return { helper, route, env, logs, store, verifyCalls: () => verifyCalls };
}
function request(email = 'person@example.invalid', ip = '192.0.2.1', password = 'synthetic-wrong-password') {
  return new Request('https://example.invalid/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
}
async function blocked(response) {
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: message });
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

test('login below thresholds works; successful logins refund account reservations but still consume IP attempts', async () => {
  const app = instance();
  for (let i = 0; i < 10; i++) assert.equal((await app.route.POST(request(undefined, undefined, 'synthetic-correct-password'))).status, 200);
  await blocked(await app.route.POST(request(undefined, undefined, 'synthetic-correct-password')));
  assert.equal(app.verifyCalls(), 10);
  assert.equal([...app.store.buckets.entries()].find(([key]) => key.includes('login-account'))[1].size, 0);
});

test('IP limit applies across accounts and before parsing request bodies or password work', async () => {
  const app = instance();
  for (let i = 0; i < 10; i++) assert.equal((await app.route.POST(request(`account${i}@example.invalid`))).status, 401);
  const malformed = request();malformed.json = () => { throw new Error('body must not be read'); };
  await blocked(await app.route.POST(malformed));
  assert.equal(app.verifyCalls(), 10);
});

test('normalized account failure limit spans IPs and independent application instances', async () => {
  const shared = backend();
  const first = instance(shared), second = instance(shared);
  for (let i = 0; i < 5; i++) {
    const app = i % 2 ? first : second;
    assert.equal((await app.route.POST(request(i % 2 ? ' PERSON@EXAMPLE.INVALID ' : 'person@example.invalid', `192.0.2.${i + 1}`))).status, 401);
  }
  await blocked(await second.route.POST(request(undefined, '192.0.2.99')));
  assert.equal(first.verifyCalls() + second.verifyCalls(), 5);
  shared.advance(600000);
  assert.equal((await first.route.POST(request())).status, 401);
});

test('invalid and unknown account credentials retain identical generic responses', async () => {
  const app = instance();
  const existing = await app.route.POST(request());
  const unknown = await app.route.POST(request('unknown@example.invalid'));
  const invalid = await app.route.POST(request('invalid', undefined, 'short'));
  assert.equal(existing.status, 401);assert.equal(unknown.status, 401);assert.equal(invalid.status, 401);
  assert.deepEqual(await existing.json(), await unknown.json());
});

test('concurrent account reservations cannot exceed five; success refunds only its own reservation', async () => {
  const shared = backend(), a = instance(shared), b = instance(shared);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).helper.checkRateLimit('login-account', 'person@example.invalid', context)));
  const allowed = results.filter(result => !('response' in result));
  assert.equal(allowed.length, 5);
  await allowed[0].release();
  const replacement = await a.helper.checkRateLimit('login-account', 'person@example.invalid', context);
  assert.ok(!('response' in replacement));
  await allowed[0].release(); // Repeated refund cannot clear another attempt.
  await blocked((await b.helper.checkRateLimit('login-account', 'person@example.invalid', context)).response);
});

test('Retry-After counts down without extending the window when blocked', async () => {
  const app = instance();
  for (let i = 0; i < 5; i++) await app.helper.checkRateLimit('login-account', 'a', context);
  app.store.advance(590000);
  const response = (await app.helper.checkRateLimit('login-account', 'a', context)).response;
  assert.equal(response.headers.get('Retry-After'), '10');
  app.store.advance(10000);
  assert.ok(!('response' in await app.helper.checkRateLimit('login-account', 'a', context)));
});

test('only the Vercel platform IP is trusted; spoofed chains and alternate headers cannot choose buckets', () => {
  const app = instance();
  const req = request();req.headers.set('x-forwarded-for', '198.51.100.99');req.headers.set('x-real-ip', '198.51.100.98');
  assert.equal(app.helper.clientIp(req), '192.0.2.1');
  req.headers.delete('x-vercel-forwarded-for');assert.equal(app.helper.clientIp(req), 'unknown');
  req.headers.set('x-vercel-forwarded-for', '192.0.2.1, 198.51.100.2');assert.equal(app.helper.clientIp(req), 'unknown');
  req.headers.set('x-vercel-forwarded-for', '2001:0db8:0000:0000:0000:0000:0000:0001');
  const ipv6 = app.helper.clientIp(req);req.headers.set('x-vercel-forwarded-for', '2001:db8::1');assert.equal(app.helper.clientIp(req), ipv6);
  app.env.VERCEL = '';assert.equal(app.helper.clientIp(req), 'unknown');
});

test('keys and diagnostics contain no sensitive identifiers, tokens, passwords or headers', async () => {
  const app = instance();
  await app.route.POST(request());
  app.store.mode('error');await app.route.POST(request());
  const keys = [...app.store.buckets.keys()];
  for (const key of keys) assert.match(key, /^green-engine:rl:v1:login-(ip|account):[a-f0-9]{64}$/);
  const logs = JSON.stringify(app.logs);
  for (const marker of ['person@example.invalid', '192.0.2.1', 'synthetic-wrong-password', app.env.UPSTASH_REDIS_REST_TOKEN, 'SENSITIVE_BACKEND_ERROR']) {
    assert.equal(logs.includes(marker), false);assert.equal(keys.join().includes(marker), false);
  }
  for (const [event, fields] of app.logs) {
    assert.match(event, /^rate_limit_(check|allowed|blocked|backend_error)$/);
    assert.deepEqual(Object.keys(fields).sort(), ['duration_ms', 'limiter', 'requestId', 'route']);
  }
  const call = app.store.calls[0];
  assert.equal(call.options.cache, 'no-store');assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers.Authorization, `Bearer ${app.env.UPSTASH_REDIS_REST_TOKEN}`);
});

test('missing configuration and backend errors fail closed before authentication, without a production fallback', async () => {
  for (const overrides of [{ UPSTASH_REDIS_REST_URL: '' }, { UPSTASH_REDIS_REST_TOKEN: '' }, { UPSTASH_REDIS_REST_URL: 'http://synthetic.upstash.io' }]) {
    const app = instance(undefined, overrides);
    for (let i = 0; i < 2; i++) assert.equal((await app.route.POST(request())).status, 503);
    assert.equal(app.verifyCalls(), 0);assert.equal(app.store.calls.length, 0);
  }
  for (const mode of ['error', 'http', 'malformed']) {
    const app = instance();app.store.mode(mode);
    const response = await app.route.POST(request());
    assert.equal(response.status, 503);assert.equal(response.headers.get('Retry-After'), '5');
    assert.equal(app.verifyCalls(), 0);assert.doesNotMatch(await response.text(), /SENSITIVE|Redis|Upstash/);
  }
});

test('connection and response-body hangs stop within the one-second deadline', async () => {
  for (const mode of ['hang', 'body-hang']) {
    const app = instance();app.store.mode(mode);
    const start = Date.now();
    assert.equal((await app.route.POST(request())).status, 503);
    assert.ok(Date.now() - start < 1800);
    assert.equal(app.store.calls[0].options.signal.aborted, true);
    assert.equal(app.verifyCalls(), 0);
  }
});

test('failed success-refund is safe and leaves the account reservation to expire', async () => {
  const app = instance();
  const reservation = await app.helper.checkRateLimit('login-account', 'a', context);
  app.store.mode('error');await reservation.release();
  assert.equal([...app.store.buckets.values()][0].size, 1);
  assert.equal(app.logs.at(-1)[0], 'rate_limit_backend_error');
});

// Phase 2B: real route handlers and limiter, with counted business-work doubles.
function protectedEndpoints() {
  const app = instance();
  let user = { id: 1, email: 'staff@example.invalid', role: 'operator' };
  let dbCalls = 0, workbookCalls = 0, duplicateCalls = 0, rowCount = 0;
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: values => ({ returning: async () => [{ id: 1, ...values }] }) }),
    transaction: async callback => callback(database),
    execute: async () => [{ report: { totals: { count: rowCount }, rows: [] } }],
  };
  function route(file) {
    const exports = {};
    const loader = name => {
      if (name.endsWith('/request-origin')) return { checkRequestOrigin: () => null };
    if (name.endsWith('/rate-limit')) return app.helper;
      if (name.endsWith('/authz')) return {
        getAppUser: async () => user,
        requireRole: async roles => user && roles.includes(user.role) ? { user } : { response: Response.json({}, { status: 403 }) },
      };
      if (name.endsWith('/db')) return {
        getHealthyDb: async () => { dbCalls++;return database; },
        createRequestDiagnostics: () => ({ requestId: 'synthetic-request', stage() {} }),
        NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
        logSlowOperation() {}, isDatabaseConnectionError: () => false,
        safeErrorResponse: error => { throw error; },
      };
      if (name.endsWith('/db/schema')) return { preBookings: {} };
      if (name === 'drizzle-orm') return { and() {}, eq() {}, gte() {} };
      if (name.endsWith('/audit')) return { writeAuditLog: async () => {} };
      if (name.endsWith('/preorder-status')) return { CONVERTED_PREORDER_STATUSES: [] };
      if (name.endsWith('/manufacture-year')) return { parseManufactureYear: () => ({ year: 2020 }), manufactureYearDatabaseError: () => null };
      if (name.endsWith('/booking-duplicates')) return { checkBookingDuplicates: async () => { duplicateCalls++;return {}; } };
      if (name.endsWith('/reports/model')) return {
        parseReportQuery: params => ({ format: params.get('format') || 'json', page: 1, filters: { from: '2026-09-01', to: '2026-09-06' } }),
        ReportValidationError: class extends Error {},
      };
      if (name.endsWith('/reports/query')) return { buildReportQuery: () => ({}), MAX_EXPORT_ROWS: 50000, REPORT_PAGE_SIZE: 50 };
      if (name.endsWith('/reports/excel')) return { createReportWorkbook: async () => { workbookCalls++;return new Uint8Array(); } };
      throw new Error('Unexpected route dependency: ' + name);
    };
    new Function('exports', 'require', compiled(file))(exports, loader);
    return exports;
  }
  return { ...app,
    preorder: route('app/api/preorder/route.ts').POST,
    preorders: route('app/api/preorders/route.ts').POST,
    duplicate: route('app/api/bookings/duplicate-check/route.ts').GET,
    report: route('app/api/reports/route.ts').GET,
    setUser: next => { user = next; }, setRows: count => { rowCount = count; },
    work: () => ({ dbCalls, workbookCalls, duplicateCalls }),
  };
}
function preorderRequest(ip = '192.0.2.1') {
  return new Request('https://example.invalid/api/preorder', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip }, body: JSON.stringify({ customer: 'SENSITIVE_NAME', phone: '12345678', plate: 'SENSITIVE_PLATE', vehicle: 'test', manufactureYear: 2020 }) });
}
const exportRequest = () => new Request('https://example.invalid/api/reports?format=xlsx');
const duplicateRequest = () => new Request('https://example.invalid/api/bookings/duplicate-check?phone=12345678&plate=SENSITIVE_PLATE');
async function blocked2B(response) {
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Хэт олон хүсэлт илгээсэн байна. Түр хүлээгээд дахин оролдоно уу.' });
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
}

test('public preorder allows five requests; aliases share burst limit before business DB work', async () => {
  const app = protectedEndpoints();app.setUser(null);
  for (let i = 0; i < 5; i++) assert.equal((await (i % 2 ? app.preorder : app.preorders)(preorderRequest())).status, 201);
  const before = app.work();
  await blocked2B(await app.preorder(preorderRequest()));
  await blocked2B(await app.preorders(preorderRequest()));
  assert.deepEqual(app.work(), before);
  assert.equal((await app.preorder(preorderRequest('192.0.2.2'))).status, 201);
});

test('preorder sustained limit blocks after 20/hour despite renewed minute allowance', async () => {
  const app = protectedEndpoints();app.setUser(null);
  for (let batch = 0; batch < 4; batch++) {
    for (let i = 0; i < 5; i++) assert.equal((await app.preorder(preorderRequest())).status, 201);
    app.store.advance(60000);
  }
  const before = app.work();
  const response = await app.preorders(preorderRequest());
  assert.equal(response.headers.get('Retry-After'), '3360');
  await blocked2B(response);assert.deepEqual(app.work(), before);
  app.store.advance(3600000);
  assert.equal((await app.preorder(preorderRequest())).status, 201);
});

test('duplicate-check is limited per authorized user, independently of phone, IP or another user', async () => {
  const app = protectedEndpoints();
  for (let i = 0; i < 60; i++) assert.equal((await app.duplicate(duplicateRequest())).status, 200);
  const before = app.work();
  await blocked2B(await app.duplicate(new Request('https://example.invalid/api/bookings/duplicate-check?phone=99999999')));
  assert.deepEqual(app.work(), before);
  app.setUser({ id: 2, email: 'other@example.invalid', role: 'admin' });
  assert.equal((await app.duplicate(duplicateRequest())).status, 200);
  app.setUser({ id: 1, email: 'staff@example.invalid', role: 'operator' });
  await blocked2B(await app.duplicate(duplicateRequest()));
  app.store.advance(60000);assert.equal((await app.duplicate(duplicateRequest())).status, 200);
});

test('Excel allows five exports then blocks before query/workbook; ordinary reports stay usable', async () => {
  const app = protectedEndpoints();
  for (let i = 0; i < 5; i++) assert.equal((await app.report(exportRequest())).status, 200);
  assert.equal(app.work().workbookCalls, 5);
  const before = app.work();await blocked2B(await app.report(exportRequest()));assert.deepEqual(app.work(), before);
  app.store.mode('error');
  const calls = app.store.calls.length;
  assert.equal((await app.report(new Request('https://example.invalid/api/reports'))).status, 200);
  assert.equal(app.store.calls.length, calls);
  app.store.mode('ok');app.setUser({ id: 2, email: 'other@example.invalid', role: 'operator' });
  assert.equal((await app.report(exportRequest())).status, 200);
});

test('mechanics and anonymous users remain forbidden before limiter or expensive work; export cap remains', async () => {
  const app = protectedEndpoints();
  for (const user of [null, { id: 3, email: 'mechanic@example.invalid', role: 'mechanic' }]) {
    app.setUser(user);
    assert.equal((await app.report(exportRequest())).status, 403);
    assert.equal((await app.duplicate(duplicateRequest())).status, 403);
  }
  assert.equal(app.store.calls.length, 0);assert.deepEqual(app.work(), { dbCalls: 0, workbookCalls: 0, duplicateCalls: 0 });
  app.setUser({ id: 1, email: 'staff@example.invalid', role: 'operator' });app.setRows(50001);
  assert.equal((await app.report(exportRequest())).status, 413);assert.equal(app.work().workbookCalls, 0);
});

test('all Phase 2B endpoints fail closed with safe 503 before business work on Redis failure', async () => {
  const app = protectedEndpoints();app.store.mode('error');
  for (const [handler, req] of [[app.preorder, preorderRequest], [app.duplicate, duplicateRequest], [app.report, exportRequest]]) {
    const response = await handler(req());assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '5');assert.doesNotMatch(await response.text(), /SENSITIVE|Redis|Upstash/);
  }
  app.setUser(null);assert.equal((await app.preorders(preorderRequest())).status, 503);
  assert.deepEqual(app.work(), { dbCalls: 0, workbookCalls: 0, duplicateCalls: 0 });
});

test('Phase 2B keys and diagnostics contain no payload/user PII; protected admin identity is stable', async () => {
  const app = protectedEndpoints();
  const admin = { id: null, email: 'PROTECTED@EXAMPLE.INVALID' };
  assert.equal(app.helper.authenticatedRateLimitIdentity(admin), app.helper.authenticatedRateLimitIdentity({ ...admin, email: admin.email.toLowerCase() }));
  await app.preorder(preorderRequest());await app.duplicate(duplicateRequest());await app.report(exportRequest());
  const keys = [...app.store.buckets.keys()];
  assert.equal(keys.length, 4);
  for (const key of keys) assert.match(key, /^green-engine:rl:v1:(preorder-ip-minute|preorder-ip-hour|duplicate-user|report-export-user):[a-f0-9]{64}$/);
  const output = JSON.stringify([keys, app.logs]);
  for (const pii of ['staff@example.invalid', '192.0.2.1', '12345678', 'SENSITIVE_NAME', 'SENSITIVE_PLATE']) assert.equal(output.includes(pii), false);
});
