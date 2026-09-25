import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const moduleFrom = (path, imports = {}) => {
  const exports = {};
  const code = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => imports[name] ?? require(name));
  return exports;
};
const validation = moduleFrom('app/input-validation.ts', { './manufacture-year': {} });
const metrics = moduleFrom('app/dashboard-metrics.ts', { './input-validation': validation });
const pg = new PGlite();
const db = drizzle(pg);
await pg.exec(`
  create table public.bookings (
    status text not null,
    programming_completed boolean default false,
    installation_completed boolean default false,
    handover_completed boolean default false,
    total_price integer not null default 0,
    advance integer not null default 0,
    final_paid integer not null default 0,
    returned_to_preorder_at timestamptz,
    booking_date text,
    branch text
  );
  insert into public.bookings(status,total_price,advance,booking_date,branch)
    select 'Хүлээгдэж буй',1000,100,'2020-01-01','Нарны замын салбар'
    from generate_series(1,501);
  insert into public.bookings(status,programming_completed,installation_completed,handover_completed,total_price)
    values
      ('Суурилуулж байна',true,false,false,1000),
      ('Баталгаажсан',false,true,false,1000),
      ('Дууссан',true,true,false,1000),
      ('Дууссан',true,true,true,1000),
      ('Хүлээгдэж буй',false,false,true,1000),
      ('Цуцлагдсан',false,false,false,9000000),
      ('cancelled',false,false,false,9000000),
      ('new',false,false,false,9000000);
  insert into public.bookings(status,total_price,returned_to_preorder_at)
    values ('Хүлээгдэж буй',9000000,now());
  insert into public.bookings(status,programming_completed,installation_completed,handover_completed,total_price)
    values
      ('Хүлээгдэж буй',null,null,null,1000),
      ('Хүлээгдэж буй',true,true,null,1000),
      ('Хүлээгдэж буй',null,true,false,1000);
`);

let role = 'admin';
let dbCalls = 0;
const route = moduleFrom('app/api/dashboard-summary/route.ts', {
  'drizzle-orm': require('drizzle-orm'),
  '../../../db': {
    getHealthyDb: async () => { dbCalls++; return { execute: async query => (await db.execute(query)).rows }; },
    isDatabaseConnectionError: () => false,
    databaseErrorResponse: () => Response.json({}, { status: 503 }),
    safeErrorResponse: error => { throw error; },
    NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
  },
  '../../authz': {
    requireRole: async allowed => role && allowed.includes(role)
      ? { user: { role } }
      : { response: Response.json({ error: 'Forbidden' }, { status: 403 }) },
  },
  '../../dashboard-metrics': metrics,
});

test('one aggregate query counts all eligible bookings beyond 500, ignoring date, branch, and visits', async () => {
  role = 'admin';
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    programmingPending: 505,
    installationPending: 504,
    handoverPending: 2,
    outstandingBalance: 458900,
  });
  assert.equal(dbCalls, 1);
  const query = read('app/api/dashboard-summary/route.ts');
  assert.doesNotMatch(query, /booking_date\s*[<=>]|service_visits|branch\s*[<=>]|limit\s*\(?500/i);
  assert.match(query, /returned_to_preorder_at is null/);
  assert.doesNotMatch(query, /operations0015Enabled/);
  assert.match(query, /sum\(greatest\(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint\)\)/);
});

test('SQL NULL completion fields count as incomplete and NULL handover counts as waiting when both services are complete', async () => {
  role = 'admin';
  const summary = await (await route.GET()).json();
  assert.equal(summary.programmingPending, 505);
  assert.equal(summary.installationPending, 504);
  assert.equal(summary.handoverPending, 2);
  const seeded = (await pg.query('select count(*)::int as count from public.bookings where programming_completed is null or installation_completed is null or handover_completed is null')).rows[0].count;
  assert.equal(seeded, 3);
});

test('authorization rejects anonymous users before database access', async () => {
  role = null;
  const before = dbCalls;
  assert.equal((await route.GET()).status, 403);
  assert.equal(dbCalls, before);
});

test('operator gets the four metrics; mechanic gets only queue counts', async () => {
  role = 'operator';
  assert.equal((await (await route.GET()).json()).outstandingBalance, 458900);
  role = 'mechanic';
  assert.deepEqual(await (await route.GET()).json(), {
    programmingPending: 505,
    installationPending: 504,
    handoverPending: 2,
  });
});
