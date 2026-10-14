import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
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
const queues = moduleFrom('app/dashboard-queues.ts', { './input-validation': validation, './dashboard-metrics': metrics });
const pg = new PGlite();
after(() => pg.close());
const db = drizzle(pg);
await pg.exec(`
  create table public.bookings (
    status text not null,
    programming_completed boolean default false,
    installation_completed boolean default false,
    handover_completed boolean default false,
    total_price integer default 0,
    advance integer default 0,
    final_paid integer default 0,
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
  '../../dashboard-queues': queues,
  '../../input-validation': validation,
});

test('one aggregate query counts all eligible bookings beyond 500, without date or list truncation', async () => {
  role = 'admin';
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    programmingPending: 2,
    installationPending: 1,
    workPending: 506,
    advanceUnpaid: 8,
    outstandingBalance: 458900,
    outstandingCount: 509,
  });
  assert.equal(dbCalls, 1);
  const query = read('app/api/dashboard-summary/route.ts');
  assert.doesNotMatch(query, /booking_date\s*[<=>]|service_visits|branch\s*[<=>]|limit\s*\(?500/i);
  assert.match(read("app/dashboard-queues.ts"), /returned_to_preorder_at is null/);
  assert.doesNotMatch(query, /operations0015Enabled/);
  assert.match(query, /sum\(greatest\(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint\)\)/);
  assert.match(query, /count\(\*\) filter \(where greatest\(0::bigint, total_price::bigint - advance::bigint - final_paid::bigint\) > 0\)/);
});

test('legacy NULL is incomplete and handover does not hide unfinished work', async () => {
  role = 'admin';
  const summary = await (await route.GET()).json();
  assert.equal(summary.programmingPending, 2);
  assert.equal(summary.installationPending, 1);
  assert.equal(summary.workPending, 506);
  const seeded = (await pg.query('select count(*)::int as count from public.bookings where programming_completed is null or installation_completed is null or handover_completed is null')).rows[0].count;
  assert.equal(seeded, 3);
  const nullHandover = (await pg.query('select count(*)::int as count from public.bookings where handover_completed is null')).rows[0].count;
  assert.equal(nullHandover, 2);
  assert.doesNotMatch(read("app/dashboard-queues.ts"), /handover_completed/);
});

test('authorization rejects anonymous users before database access', async () => {
  role = null;
  const before = dbCalls;
  assert.equal((await route.GET()).status, 403);
  assert.equal(dbCalls, before);
});

test('operator gets both financial metrics; mechanic gets only queue counts', async () => {
  role = 'operator';
  const operatorSummary = await (await route.GET()).json();
  assert.equal(operatorSummary.outstandingBalance, 458900);
  assert.equal(operatorSummary.outstandingCount, 509);
  role = 'mechanic';
  assert.deepEqual(await (await route.GET()).json(), {
    programmingPending: 2,
    installationPending: 1,
    workPending: 506,
  });
});

// Nullable payment columns exist only in this isolated fixture so legacy NULL
// behavior can be exercised without changing the application's schema.
const booking = (overrides = {}) => ({
  status: 'Хүлээгдэж буй', totalPrice: 1000, advance: 0, finalPaid: 0,
  returnedToPreorderAt: null,
  programmingCompleted: false, installationCompleted: false, handoverCompleted: false,
  ...overrides,
});
const partial = booking({ totalPrice: 2000, advance: 500, finalPaid: 250 });
const paid = booking({ totalPrice: 3000, advance: 1000, finalPaid: 2000 });
const cancelled = booking({ status: 'Цуцлагдсан', totalPrice: 9000000 });
const returned = booking({ returnedToPreorderAt: '2026-09-24T00:00:00Z', totalPrice: 9000000 });

for (const [name, rows, count, balance] of [
  ['unpaid eligible booking', [booking()], 1, 1000],
  ['partially paid eligible booking', [partial], 1, 1250],
  ['fully paid eligible booking', [paid], 0, 0],
  ['two unpaid/partially paid eligible bookings', [booking(), partial], 2, 2250],
  ['cancelled booking with apparent remaining balance', [cancelled], 0, 0],
  ['English cancelled status', [booking({ status: 'cancelled' })], 0, 0],
  ['returned-to-preorder active booking', [returned], 0, 0],
  ['unknown status', [booking({ status: 'new' })], 0, 0],
  ['completed and handed-over booking still owing payment', [booking({
    status: 'Дууссан', programmingCompleted: true, installationCompleted: true, handoverCompleted: true,
  })], 1, 1000],
  ['mixed eligibility and payments', [booking(), partial, paid, cancelled, returned,
    booking({ status: 'cancelled' }), booking({ status: 'new' }),
    booking({ status: 'Дууссан', handoverCompleted: true, totalPrice: 500 })], 3, 2750],
  ['no bookings', [], 0, 0],
  ['zero price', [booking({ totalPrice: 0 })], 0, 0],
  ['overpayment', [booking({ advance: 600, finalPaid: 500 })], 0, 0],
  ['NULL total price', [booking({ totalPrice: null })], 0, 0],
  ['NULL advance', [booking({ advance: null })], 0, 0],
  ['NULL final payment', [booking({ finalPaid: null })], 0, 0],
  ['all NULL payment fields', [booking({ totalPrice: null, advance: null, finalPaid: null })], 0, 0],
  ['mixed NULL and payable balances', [booking({ advance: null }), partial, paid], 1, 1250],
  ['negative remaining balance', [booking({ totalPrice: -1000 })], 0, 0],
  ['negative payment follows existing subtraction', [booking({ advance: -100, finalPaid: -50 })], 1, 1150],
  ['bigint arithmetic avoids integer overflow', [booking({ totalPrice: 2147483647, advance: -2147483648, finalPaid: -2147483648 })], 1, 6442450943],
]) {
  test(`aggregate balance and count: ${name}`, async () => {
    role = 'admin';
    await pg.exec('begin; truncate public.bookings;');
    try {
      for (const row of rows) {
        await pg.query(`insert into public.bookings
          (status,total_price,advance,final_paid,returned_to_preorder_at,
           programming_completed,installation_completed,handover_completed,booking_date,branch)
          values ($1,$2,$3,$4,$5,$6,$7,$8,'2020-01-01','Нарны замын салбар')`, [
          row.status, row.totalPrice, row.advance, row.finalPaid, row.returnedToPreorderAt,
          row.programmingCompleted, row.installationCompleted, row.handoverCompleted,
        ]);
      }
      const before = dbCalls;
      const response = await route.GET();
      assert.equal(response.status, 200);
      const summary = await response.json();
      assert.equal(summary.outstandingCount, count);
      assert.equal(summary.outstandingBalance, balance);
      assert.equal(dbCalls - before, 1, 'both metrics come from one aggregate query');
    } finally {
      await pg.exec('rollback;');
    }
  });
}

 test('branch scope and drilldown predicates agree beyond the default list limit', async () => {
  role = 'admin';
  const summary = await (await route.GET(new Request('http://localhost/api/dashboard-summary?branch=' + encodeURIComponent('Нарны замын салбар')))).json();
  assert.equal(summary.workPending, 501);
  assert.equal(summary.programmingPending, 0);
  for (const [queue, key] of [['installed-not-programmed','programmingPending'], ['programmed-not-installed','installationPending'], ['work-pending','workPending']]) {
    const result = await db.execute(require('drizzle-orm').sql`select count(*)::int as count from bookings where ${queues.dashboardScope('Нарны замын салбар')} and ${queues.dashboardQueueCondition(queue)}`);
    assert.equal(result.rows[0].count, summary[key]);
  }
  assert.equal((await route.GET(new Request('http://localhost/?branch=invalid'))).status, 400);
 });

 test('zero total paid excludes partial/full payments and inactive records, including zero-price bookings', async () => {
  role = 'operator';
  await pg.exec('begin; truncate bookings;');
  try {
    await pg.exec(`insert into bookings(status,total_price,advance,final_paid,branch) values
      ('Хүлээгдэж буй',1000,0,0,'16-ын салбар'),
      ('Дууссан',1000,0,200,'16-ын салбар'),
      ('Дууссан',1000,0,1000,'16-ын салбар'),
      ('Хүлээгдэж буй',1000,100,0,'16-ын салбар'),
      ('Хүлээгдэж буй',0,0,0,'16-ын салбар'),
      ('Цуцлагдсан',1000,0,0,'16-ын салбар'),
      ('Хүлээгдэж буй',1000,0,0,'3-р салбар');`);
    const branch = '16-ын салбар';
    const summary = await (await route.GET(new Request('http://localhost/?branch=' + encodeURIComponent(branch)))).json();
    assert.equal(summary.advanceUnpaid, 2);
    const result = await db.execute(require('drizzle-orm').sql`select count(*)::int as count from bookings where ${queues.dashboardScope(branch)} and ${queues.dashboardQueueCondition('advance-unpaid')}`);
    assert.equal(result.rows[0].count, summary.advanceUnpaid);
    role = 'mechanic';
    assert.equal((await (await route.GET()).json()).advanceUnpaid, undefined);
  } finally { await pg.exec('rollback'); }
 });

test('actual booking GET matches all four card counts in every branch; work-pending includes both single-step queues', async () => {
  const { sql } = require('drizzle-orm');
  const schema = moduleFrom('db/schema.ts');
  const bookingRoute = moduleFrom('app/api/bookings/route.ts', {
    '../../../db/notes': { withNoteSummaries: async (_db, _owner, rows) => rows },
    '../../input-validation': validation,
    '../../request-origin': {},
    '../../../db': {
      getHealthyDb: async () => db,
      createRequestDiagnostics: () => ({ stage() {} }),
      isDatabaseConnectionError: () => false,
      safeErrorResponse: error => { throw error; },
      NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
    },
    '../../../db/schema': schema,
    '../../authz': {
      requireRole: async () => ({ user: { role } }),
      bookingForRole: (row, role) => role === 'mechanic' ? { ...row, totalPrice: undefined, advance: undefined, finalPaid: undefined } : row,
    },
    '../../audit': {}, '../../../db/booking-capacity': {}, '../../booking-duplicates': {}, '../../manufacture-year': {},
    '../../operations-0015': { operations0015Enabled: async () => true },
    '../../dashboard-queues': queues,
  });
  await pg.exec(`begin;
    alter table bookings add column id serial primary key, add column booking_no text default 'TEST',
      add column customer text default 'Test', add column phone text default '00000000',
      add column plate text default 'TEST', add column vehicle text default 'Test',
      add column manufacture_year smallint, add column product_id integer, add column product_name text default '',
      add column booking_time text default '09:00', add column receipt text default '',
      add column advance_type text, add column advance_note text default '',
      add column programming_completed_at timestamptz, add column programming_completed_by jsonb,
      add column installation_completed_at timestamptz, add column installation_completed_by jsonb,
      add column handover_completed_at timestamptz, add column handover_completed_by jsonb,
      add column capacity_slot smallint, add column created_at timestamp default now();
    create table service_visits (booking_id integer);
  `);
  try {
    // Every legacy boolean state, every supported/inactive status, and every branch.
    for (const branch of validation.BRANCHES) {
      for (const status of [...validation.BOOKING_STATUSES, 'new']) {
        for (const programming of [true, false, null]) for (const installation of [true, false, null]) for (const handover of [true, false, null]) {
          await pg.query(`insert into bookings(status,branch,programming_completed,installation_completed,handover_completed,total_price,advance,final_paid,booking_date)
            values ($1,$2,$3,$4,$5,1000,0,0,'2026-10-14')`, [status,branch,programming,installation,handover]);
        }
      }
    }
    const installation = queues.dashboardQueueCondition('programmed-not-installed');
    const programming = queues.dashboardQueueCondition('installed-not-programmed');
    const pending = queues.dashboardQueueCondition('work-pending');
    const missingSubset = await db.execute(sql`select count(*)::int as count from bookings where
      ((${installation}) or (${programming})) and not (${pending})`);
    assert.equal(missingSubset.rows[0].count, 0);
    const singleStepOverlap = await db.execute(sql`select count(*)::int as count from bookings where (${installation}) and (${programming})`);
    assert.equal(singleStepOverlap.rows[0].count, 0);
    const intentionalOverlap = await db.execute(sql`select count(*)::int as count from bookings where (${pending}) and ((${installation}) or (${programming}))`);
    assert.ok(intentionalOverlap.rows[0].count > 0);
    role = 'admin';
    for (const branch of ['', ...validation.BRANCHES]) {
      const summary = await (await route.GET(new Request('http://localhost/?' + new URLSearchParams({branch})))).json();
      for (const [queue, key] of [['installed-not-programmed','programmingPending'],['programmed-not-installed','installationPending'],['work-pending','workPending'],['advance-unpaid','advanceUnpaid']]) {
        const response = await bookingRoute.GET(new Request('http://localhost/?' + new URLSearchParams({branch, dashboardQueue:queue})));
        assert.equal(response.status, 200);
        const rows = (await response.json()).bookings;
        assert.equal(rows.length, summary[key], `${branch || 'all'} / ${queue}`);
        assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
        for (const row of rows) {
          assert.ok(metrics.activeMainStatuses.includes(row.status));
          if (branch) assert.equal(row.branch, branch);
          if (queue === 'installed-not-programmed') assert.ok(row.installationCompleted === true && row.programmingCompleted !== true);
          if (queue === 'programmed-not-installed') assert.ok(row.programmingCompleted === true && row.installationCompleted !== true);
          if (queue === 'work-pending') assert.ok(row.programmingCompleted !== true || row.installationCompleted !== true);
          if (queue === 'advance-unpaid') assert.equal(row.advance + row.finalPaid, 0);
        }
      }
    }
    const large = await bookingRoute.GET(new Request('http://localhost/?dashboardQueue=work-pending&branch=' + encodeURIComponent('Нарны замын салбар')));
    assert.ok((await large.json()).bookings.length > 500);
    role = 'mechanic';
    assert.equal((await bookingRoute.GET(new Request('http://localhost/?dashboardQueue=advance-unpaid'))).status, 403);
    assert.equal((await bookingRoute.GET(new Request('http://localhost/?dashboardQueue=invalid'))).status, 400);
  } finally { await pg.exec('rollback'); }
});
