import assert from 'node:assert/strict';
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
        clients.push(client);
        return client;
      } };
      if (name === 'drizzle-orm/postgres-js') return { drizzle: client => ({ client }) };
      if (name === './schema' || name === './booking-capacity') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { DATABASE_URL: 'postgres://fixture:fixture@pooler.example.invalid:6543/postgres' } },
    globalThis: state,
    console: { info: (_, detail) => stages.push(detail.stage) },
    setTimeout: (callback, ms) => { const timer = { callback, ms }; timers.push(timer); return timer; },
    clearTimeout: timer => { timer.cleared = true; },
  });
  return { api, clients, timers, stages, state };
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
    assert.equal(a.client, h.clients[1]);
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
