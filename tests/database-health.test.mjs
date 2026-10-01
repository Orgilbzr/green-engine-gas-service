import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, bindings) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(bindings), code)(exports, ...Object.values(bindings));
  return exports;
}

function harness(outcomes) {
  const clients = [];
  const timers = [];
  const stages = [];
  const state = {};
  let activeTiming;
  let now = 100_000;
  class Clock extends Date { static now() { return now; } }
  const api = load('../db/index.ts', {
    require(name) {
      if (name === 'postgres') return { default() {
        const outcome = outcomes[clients.length];
        assert.ok(outcome, 'unexpected additional replacement');
        const client = query => {
          assert.equal(query.join(''), 'SELECT 1');
          client.queries++;
          if (outcome === 'timeout') return new Promise(() => {});
          return outcome === 'fail' ? Promise.reject(new Error('connection lost')) : Promise.resolve();
        };
        client.queries = 0;
        client.ends = [];
        client.end = async options => { client.ends.push(options); };
        client.unsafe = statement => {
          client.realQueries++;
          const fails = statement === 'FAIL';
          return { values() { return this; }, then(resolve, reject) {
            return (fails ? Promise.reject(new Error('query failed')) : Promise.resolve([{ ok: true }])).then(resolve, reject);
          } };
        };
        client.realQueries = 0;
        client.begin = async callback => callback({ unsafe: client.unsafe, savepoint: async nested => nested({ unsafe: client.unsafe }) });
        clients.push(client);
        return client;
      } };
      if (name === 'drizzle-orm/postgres-js') return { drizzle: client => ({ client }) };
      if (name === './schema' || name === './booking-capacity') return {};
      if (name === './request-timing') return { currentRequestTiming: () => activeTiming };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { DATABASE_URL: 'postgres://fixture:fixture@pooler.example.invalid:6543/postgres' } },
    globalThis: state,
    console: { info: (_, detail) => stages.push(detail.stage) },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
    Date: Clock,
  });
  return { api, clients, timers, stages, state, advance: ms => { now += ms; }, setTiming: timing => { activeTiming = timing; } };
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test('successful preflight uses a 5000ms deadline and retains the client', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 5000);
  assert.equal(h.timers[0].cleared, true);
  assert.equal(db, h.api.getDb());
  assert.equal(h.clients.length, 1);
  assert.equal(h.clients[0].ends.length, 0);
});

test('timing records executed SELECT 1 and distinguishes a skipped preflight', async () => {
  const h = harness(['ok']);
  const events = [];
  h.setTiming({ preflight: duration => events.push(['select', duration]), dbCheck: (state, duration) => events.push([state, duration]) });
  await h.api.getHealthyDb();
  await h.api.getHealthyDb();
  assert.deepEqual(events.map(([event]) => event), ['select', 'executed', 'skipped']);
  assert.ok(events.every(([, duration]) => Number.isFinite(duration) && duration >= 0));
  assert.equal(h.clients[0].queries, 1);
});

test('Server-Timing reports an executed preflight without exposing query details', async () => {
  const { RequestTiming } = load('../db/request-timing.ts', { require: () => ({ AsyncLocalStorage }) });
  const timing = new RequestTiming();
  const h = harness(['ok']);
  h.setTiming(timing);
  await h.api.getHealthyDb();
  const header = timing.finish(new Response()).headers.get('Server-Timing');
  assert.match(header, /db-preflight;dur=\d+\.\d{2};desc="executed"/);
  assert.match(header, /db-ready;dur=\d+\.\d{2}/);
  assert.doesNotMatch(header, /SELECT 1|pooler\.example|fixture/);
});

test('successful real queries refresh activity; idle connections still preflight', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 1);
  h.advance(900);
  await db.client.unsafe('SELECT actual work').values();
  h.advance(900);
  assert.equal(await h.api.getHealthyDb(), db);
  assert.equal(h.clients[0].queries, 1);
  h.advance(1010);
  await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 2);
});

test('a completed transaction counts as healthy activity, including reserved connection work', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  h.advance(900);
  await db.client.begin(async tx => { await tx.unsafe('SELECT in transaction'); });
  h.advance(900);
  await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 1);
  assert.equal(h.clients[0].realQueries, 1);
});

test('a transaction that fails after a successful inner query is not marked healthy', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  await assert.rejects(db.client.begin(async tx => {
    await tx.unsafe('SELECT in transaction');
    throw new Error('rollback');
  }), /rollback/);
  await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 2);
});

test('BEGIN and successful inner work do not mark activity before COMMIT; a failed COMMIT forces preflight', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  let failCommit;
  const commit = new Promise((_, reject) => { failCommit = () => reject(new Error('commit failed')); });
  h.clients[0].begin = async callback => {
    await callback({ unsafe: h.clients[0].unsafe });
    await commit;
  };
  h.advance(500);
  const pending = db.client.begin(async tx => { await tx.unsafe('SELECT in transaction'); });
  await flush();
  assert.equal(h.clients[0].realQueries, 1);
  assert.equal(h.state.__greenEngineLastActivity, 100_000);
  failCommit();
  await assert.rejects(pending, /commit failed/);
  assert.equal(h.state.__greenEngineLastActivity, 0);
  await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 2);
});

test('a failed application query never refreshes activity and forces the next health check', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  h.advance(500);
  await assert.rejects(async () => db.client.unsafe('FAIL'), /query failed/);
  await h.api.getHealthyDb();
  assert.equal(h.clients[0].queries, 2);
});

test('concurrent callers after a successful query skip preflight safely', async () => {
  const h = harness(['ok']);
  const db = await h.api.getHealthyDb();
  h.advance(900);
  await db.client.unsafe('SELECT actual work');
  h.advance(900);
  const results = await Promise.all(Array.from({ length: 8 }, () => h.api.getHealthyDb()));
  assert.ok(results.every(value => value === db));
  assert.equal(h.clients[0].queries, 1);
});

for (const outcome of ['fail', 'timeout']) {
  test(`${outcome} preflight recycles once and shares the replacement across callers`, async () => {
    const h = harness([outcome, 'ok']);
    const first = h.api.getHealthyDb();
    const second = h.api.getHealthyDb();
    if (outcome === 'timeout') {
      await flush();
      assert.equal(h.clients.length, 1);
      assert.equal(h.timers[0].ms, 5000);
      h.timers[0].callback();
    }
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(a.client, h.api.getDb().client);
    assert.equal(h.clients.length, 2);
    assert.deepEqual(h.clients.map(c => c.queries), [1, 1]);
    assert.deepEqual(h.clients[0].ends, [{ timeout: 0.1 }]);
    assert.equal(h.stages.filter(s => s === 'client_recycle').length, 1);
    assert.ok(h.timers.every(t => t.ms === 5000));
  });

  test(`${outcome} replacement preflight fails without a second replacement attempt`, async () => {
    const h = harness(['fail', outcome]);
    const pending = h.api.getHealthyDb();
    const rejected = assert.rejects(pending, outcome === 'timeout' ? /preflight_timeout/ : /connection lost/);
    await flush();
    if (outcome === 'timeout') h.timers[1].callback();
    await rejected;
    assert.equal(h.clients.length, 2);
    assert.deepEqual(h.clients.map(c => c.ends), [[{ timeout: 0.1 }], [{ timeout: 0.1 }]]);
    assert.equal(h.stages.filter(s => s === 'client_recycle').length, 1);
  });
}

const capacity = load('../db/booking-capacity.ts', { require: () => ({}) });
for (const operation of ['insert', 'update', 'delete']) {
  test(`${operation} with uncertain write or commit completion is never automatically retried`, async () => {
    for (const atCommit of [false, true]) {
      const failure = Object.assign(new Error('connection timed out after write'), { code: 'ECONNRESET' });
      let transactions = 0;
      let writes = 0;
      const h = harness(['ok']);
      const db = await h.api.getHealthyDb();
      db.transaction = async callback => {
        transactions++;
        const result = await callback({ [operation]: async () => {
          writes++;
          if (!atCommit) throw failure;
        } });
        if (atCommit) throw failure;
        return result;
      };
      await assert.rejects(capacity.withBookingCapacity(db, tx => tx[operation]()), error => error === failure);
      assert.equal(transactions, 1);
      assert.equal(writes, 1);
      assert.equal(h.clients.length, 1);
      assert.equal(h.stages.includes('client_recycle'), false);
    }
  });
}
