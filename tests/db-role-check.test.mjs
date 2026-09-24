import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/admin/db-role-check/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function routeFor(role, gate = 'true', result = [{ current_user: 'gas_app_runtime', session_user: 'gas_app_runtime', ignored: 'secret' }]) {
  const calls = { roles: [], queries: [], db: 0 };
  const exports = {};
  const modules = {
    'drizzle-orm': { sql: parts => ({ text: parts.join('') }) },
    '../../../authz': { requireRole: async allowed => {
      calls.roles.push(Array.from(allowed));
      return role && allowed.includes(role) ? { user: { role } } : { response: Response.json({ error: 'Forbidden' }, { status: 403 }) };
    } },
    '../../../../db': { getHealthyDb: async () => {
      calls.db++;
      return { execute: async query => { calls.queries.push(query.text); return result; } };
    } },
  };
  vm.runInNewContext(compiled, { exports, require: name => modules[name], Response,
    process: { env: gate === null ? {} : { DB_ROLE_CHECK_ENABLED: gate } } });
  return { route: exports, calls };
}

test('diagnostic defaults off and malformed gate fails closed before authentication or DB access', async () => {
  for (const gate of [null, '', 'TRUE', '1', 'false']) {
    const { route, calls } = routeFor('admin', gate);
    const response = await route.GET();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls.roles, []);
    assert.equal(calls.db, 0);
  }
});

test('only authenticated admin may query the role', async () => {
  for (const role of [null, 'operator', 'mechanic', 'admin']) {
    const { route, calls } = routeFor(role);
    const response = await route.GET();
    assert.deepEqual(calls.roles, [['admin']]);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.status, role === 'admin' ? 200 : 403);
    assert.equal(calls.db, role === 'admin' ? 1 : 0);
    assert.deepEqual(calls.queries, role === 'admin' ? ['SELECT current_user, session_user'] : []);
    if (role === 'admin') {
      assert.deepEqual(await response.json(), { currentUser: 'gas_app_runtime', sessionUser: 'gas_app_runtime' });
    }
  }
});

test('diagnostic has no mutating methods and non-GET requests cannot run the query', async () => {
  const { route, calls } = routeFor('admin');
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(route[method], undefined);
  for (const method of ['HEAD', 'OPTIONS']) {
    const response = route[method]();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.db, 0);
  assert.deepEqual(calls.queries, []);
  assert.doesNotMatch(source, /console\.|logger\.|DATABASE_URL|hostname|password/i);
});
