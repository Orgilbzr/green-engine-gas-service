import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postgres from 'postgres';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../db/index.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

// Exercise the actual application constructor and installed driver's URL parser.
// postgres() is lazy: these tests never issue a query or open a connection.
function createClient(env) {
  const exports = {};
  let client;
  new Function('exports', 'require', 'process', 'globalThis', compiled)(
    exports,
    name => {
      if (name === 'postgres') return { default: (url, options) => (client = postgres(url, options)) };
      if (name === 'drizzle-orm/postgres-js') return { drizzle: () => ({}) };
      if (name === './schema' || name === './booking-capacity') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    { env },
    {},
  );
  exports.getDb();
  return client;
}

const url = 'postgres://fixture:fixture@pooler.example.invalid:6543/postgres';

test('TLS verification is mandatory even when URL SSL settings request a downgrade', async () => {
  for (const query of ['', '?sslmode=disable', '?ssl=false', '?sslmode=require', '?sslmode=prefer']) {
    const client = createClient({ DATABASE_URL: url + query });
    try {
      assert.deepEqual(client.options.ssl, { rejectUnauthorized: true });
      assert.equal(client.options.prepare, false);
      assert.equal(client.options.max, 1);
      assert.equal(client.options.idle_timeout, 20);
      assert.equal(client.options.connect_timeout, 10);
      assert.equal(client.options.connection.statement_timeout, 10000);
      assert.equal(client.options.connection.lock_timeout, 10000);
      assert.deepEqual(client.options.host, ['pooler.example.invalid']);
      assert.deepEqual(client.options.port, [6543]);
    } finally {
      await client.end();
    }
  }
});

test('explicit verification overrides PGSSL environment downgrade', async () => {
  const previous = process.env.PGSSL;
  process.env.PGSSL = 'require';
  try {
    const client = createClient({ DATABASE_URL: url });
    try {
      assert.equal(client.options.ssl.rejectUnauthorized, true);
    } finally {
      await client.end();
    }
  } finally {
    if (previous === undefined) delete process.env.PGSSL;
    else process.env.PGSSL = previous;
  }
});

test('custom CA is passed intact without replacing hostname verification', async () => {
  const ca = '-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----\n';
  const client = createClient({ DATABASE_URL: url, DATABASE_SSL_CA: ca });
  try {
    assert.deepEqual(client.options.ssl, { rejectUnauthorized: true, ca });
    assert.equal(client.options.ssl.checkServerIdentity, undefined);
    assert.equal(client.options.ssl.servername, undefined);
  } finally {
    await client.end();
  }
});

test('missing database URL fails before constructing a client', () => {
  assert.throws(() => createClient({}), /Missing DATABASE_URL/);
});
