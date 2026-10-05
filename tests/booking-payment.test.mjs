import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

// Only isolated PostgreSQL; no .env or production connection.
const require = createRequire(import.meta.url), root = new URL('../', import.meta.url);
const pg = new PGlite();
after(() => pg.close());
let database, role = 'operator', auditFailure = false;
const cache = new Map();
function load(relative) {
  const url = new URL(relative, root);
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {};
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loader = name => {
    if (name.endsWith('/authz')) return { requireRole: async roles => roles.includes(role) ? { user: { id: null, email: 'payment-test@example.invalid', role } } : { response: Response.json({}, { status: 403 }) } };
    if (name.endsWith('/rate-limit')) return { authenticatedRateLimitIdentity: () => 'test', checkRateLimit: async () => ({}) };
    if (name === '../../../audit') { const audit = load('app/audit.ts'); return { ...audit, writeAuditLog: async (...args) => { if (auditFailure) throw Error('synthetic audit failure'); return audit.writeAuditLog(...args); } }; }
    if (!name.startsWith('.')) return require(name);
    const target = new URL(name, url);
    if (target.href === new URL('db', root).href) return { getHealthyDb: async () => database, createRequestDiagnostics: () => ({stage(){}}), NO_STORE_HEADERS: {'Cache-Control':'no-store'}, isDatabaseConnectionError: () => false, safeErrorResponse: () => Response.json({}, {status:500}) };
    return load(target.href + '.ts');
  };
  new Function('exports', 'require', 'process', code)(exports, loader, { env: { NODE_ENV:'production', OPERATIONS_0015_ENABLED:'false' } });
  cache.set(url.href, exports); return exports;
}
const schema = load('db/schema.ts');
database = drizzle(pg, {schema});
for (const name of ['0006_postgres_supabase','0007_preorder_schema','0008_three_booking_capacity','0009_capacity_slots','0010_booking_number_audit','0011_vehicle_year_duplicate_support','0012_require_manufacture_year_for_new_records','0013_service_process','0014_booking_notes','0015_note_soft_delete_and_booking_return']) await pg.exec(readFileSync(new URL(`drizzle/${name}.sql`,root),'utf8'));
const {PATCH} = load('app/api/bookings/[id]/route.ts');
const patch = (id, body, origin='https://gas.ecoauto.app', key=body.paymentAmount!==undefined?crypto.randomUUID():undefined) => PATCH(new Request(`https://gas.ecoauto.app/api/bookings/${id}`, {method:'PATCH',headers:{origin,'content-type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)}), {params:Promise.resolve({id:String(id)})});
let n=0;
async function booking(overrides={}) {
  n++;
  const [row] = await database.insert(schema.bookings).values({bookingNo:`PAY-${n}`,customer:'Fixture',phone:'99112233',plate:`${1000+n}УБА`,vehicle:'Toyota',manufactureYear:2020,branch:'16-ын салбар',bookingDate:new Date(Date.UTC(2026,10,n)).toISOString().slice(0,10),bookingTime:'09:00',capacitySlot:1,totalPrice:5000000,advance:1000000,finalPaid:0,status:'Баталгаажсан',...overrides}).returning();
  return row;
}
async function get(id) {return (await database.select().from(schema.bookings).where(eq(schema.bookings.id,id)))[0];}
async function audits(id) {return database.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId,id));}

test('A/B/C: completion is authoritative and retains cumulative payment plus service flags', async () => {
  for (const previous of [0,1000000]) {
    const row=await booking({finalPaid:previous,installationCompleted:true});
    assert.equal((await patch(row.id,{completePayment:true})).status,200);
    const saved=await get(row.id);
    assert.equal(saved.finalPaid,4000000);assert.equal(saved.totalPrice-saved.advance-saved.finalPaid,0);
    assert.equal(saved.status,'Дууссан');assert.equal(saved.installationCompleted,true);assert.equal(saved.programmingCompleted,false);assert.equal(saved.handoverCompleted,false);
    const [audit]=await audits(row.id);assert.equal(audit.action,'booking.payment_updated');
    assert.deepEqual(audit.details.finalPaid,{from:previous,to:4000000});
  }
});

test('D: concurrent and repeated completion settle once and create one payment audit', async () => {
  const row=await booking({finalPaid:1000000});
  const responses=await Promise.all([patch(row.id,{completePayment:true}),patch(row.id,{completePayment:true})]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal((await patch(row.id,{completePayment:true})).status,200);
  assert.equal((await get(row.id)).finalPaid,4000000);assert.equal((await audits(row.id)).length,1);
});

test('absolute PATCH remains cumulative, rejects stale reductions/overpayment and is idempotent', async () => {
  const row=await booking();
  assert.equal((await patch(row.id,{finalPaid:1000000})).status,200);
  assert.equal((await patch(row.id,{finalPaid:4000000})).status,200);
  assert.equal((await patch(row.id,{finalPaid:4000000})).status,200);
  assert.equal((await patch(row.id,{finalPaid:3000000})).status,409);
  assert.equal((await patch(row.id,{finalPaid:4000001})).status,400);
  assert.equal((await patch(row.id,{finalPaid:-1})).status,400);
  assert.equal((await get(row.id)).finalPaid,4000000);
  assert.equal((await audits(row.id)).length,2);
});

test('completion reads latest state after a partial payment, not stale frontend amounts', async () => {
  const row=await booking();
  await patch(row.id,{finalPaid:1000000});
  await patch(row.id,{completePayment:true});
  assert.equal((await get(row.id)).finalPaid,4000000);
});

test('status is independently editable with an outstanding balance; process milestones are independent', async () => {
  const row=await booking();
  assert.equal((await patch(row.id,{status:'Дууссан'})).status,200);
  const saved=await get(row.id);assert.equal(saved.finalPaid,0);assert.equal(saved.status,'Дууссан');assert.equal(saved.handoverCompleted,false);
});

test('cancelled, returned marker and returned lineage reject payments without flag or data repair', async () => {
  for (const status of ['cancelled','Цуцлагдсан']) {
    const row=await booking({status});assert.equal((await patch(row.id,{completePayment:true})).status,409);assert.equal((await patch(row.id,{finalPaid:1000000})).status,409);assert.equal((await get(row.id)).finalPaid,0);
  }
  for (const mode of ['marker','lineage']) {
    const row=await booking(mode==='marker'?{status:'cancelled',advance:0,capacitySlot:null}:{});
    if(mode==='marker') await pg.query('update bookings set returned_to_preorder_at=now() where id=$1',[row.id]);
    else await pg.query("insert into pre_bookings(customer,phone,vehicle,manufacture_year,source,status,returned_from_booking_id) values('Fixture','99112233','Toyota',2020,'manual','new',$1)",[row.id]);
    assert.equal((await patch(row.id,{completePayment:true})).status,409);assert.equal((await patch(row.id,{finalPaid:1000000})).status,409);
    assert.equal((await get(row.id)).finalPaid,0);assert.equal((await audits(row.id)).length,0);
  }
});

test('permissions, origin, invalid/mixed intent, and existing overpaid data are handled safely', async () => {
  const row=await booking();role='mechanic';assert.equal((await patch(row.id,{completePayment:true})).status,403);role='operator';
  assert.equal((await patch(row.id,{completePayment:true},'https://evil.invalid')).status,403);
  for(const body of [{completePayment:false},{completePayment:'true'},{completePayment:true,finalPaid:1},{completePayment:true,status:'Дууссан'}]) assert.equal((await patch(row.id,body)).status,400);
  const overpaid=await booking({finalPaid:4500000});await patch(overpaid.id,{completePayment:true});assert.equal((await get(overpaid.id)).finalPaid,4500000);
});

test('F/G: actual updated DB row reconciles with unchanged report formula and scheduled-date filter', async () => {
  const row=await booking({finalPaid:1000000});await patch(row.id,{completePayment:true});
  const {buildReportQuery}=load('app/reports/query.ts');
  const report = async (from,to) => {
    const query = new PgDialect().sqlToQuery(buildReportQuery({from,to},1));
    return (await pg.query(query.sql,query.params)).rows[0].report;
  };
  const data=await report(row.bookingDate,row.bookingDate);assert.equal(data.rows.length,1);
  const detail=data.rows[0];assert.deepEqual([detail.totalPrice,detail.advance,detail.finalPaid,detail.remaining],[5000000,1000000,4000000,0]);
  assert.equal(data.totals.sales,5000000);assert.equal(data.totals.advance,1000000);assert.equal(data.totals.remaining,0);
  assert.equal((await report('2000-01-01','2000-01-02')).totals.count,0);
});

test('frontend opens payment dialog and never calculates a cumulative replacement',()=>{
  const source=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(source,/onComplete=\{setPaymentTarget\}/);assert.match(source,/<PaymentDialog/);assert.doesNotMatch(source,/finalPaid: balance\(b\)/);
});

 test('audit failure rolls back payment and status together', async () => {
  const row=await booking({finalPaid:1000000});auditFailure=true;
  try {assert.equal((await patch(row.id,{completePayment:true})).status,500);}
  finally {auditFailure=false;}
  const saved=await get(row.id);assert.equal(saved.finalPaid,1000000);assert.equal(saved.status,'Баталгаажсан');assert.equal((await audits(row.id)).length,0);
});


test('partial A/B/C/J/K: successive delta payments accumulate, settle, retain status and reconcile reports', async () => {
  const row=await booking({advance:0,installationCompleted:true});
  for(const [amount,paid,remaining] of [[2000000,2000000,3000000],[1000000,3000000,2000000],[2000000,5000000,0]]) {
    assert.equal((await patch(row.id,{paymentAmount:amount})).status,200);
    const saved=await get(row.id);assert.equal(saved.finalPaid,paid);assert.equal(saved.totalPrice-saved.advance-saved.finalPaid,remaining);
    assert.equal(saved.status,'Баталгаажсан');assert.equal(saved.installationCompleted,true);assert.equal(saved.handoverCompleted,false);
    const {buildReportQuery}=load('app/reports/query.ts');const query=new PgDialect().sqlToQuery(buildReportQuery({from:row.bookingDate,to:row.bookingDate},1));
    const report=(await pg.query(query.sql,query.params)).rows[0].report;
    assert.equal(report.rows[0].finalPaid,paid);assert.equal(report.rows[0].remaining,remaining);assert.equal(report.totals.remaining,remaining);
  }
  const logs=await audits(row.id);assert.equal(logs.length,3);assert.equal(logs[0].details.paymentAmount,2000000);assert.deepEqual(logs[1].details.finalPaid,{from:2000000,to:3000000});
});

test('partial D/E: invalid amounts, mixed writes, missing key and overpayment reject without changes', async () => {
  const row=await booking({advance:0});
  for(const amount of [0,-1,'','no',1.5,'1e6',null,5000001]) assert.ok([400,409].includes((await patch(row.id,{paymentAmount:amount})).status));
  assert.equal((await patch(row.id,{paymentAmount:1},undefined,'')).status,400);
  for(const body of [{paymentAmount:1,finalPaid:1},{paymentAmount:1,status:'Дууссан'},{paymentAmount:1,completePayment:true}]) assert.equal((await patch(row.id,body)).status,400);
  assert.equal((await get(row.id)).finalPaid,0);assert.equal((await audits(row.id)).length,0);
});

test('partial F: concurrent duplicate key and replay record one payment; changed amount conflicts', async () => {
  const row=await booking({advance:0}),key=crypto.randomUUID();
  const responses=await Promise.all([patch(row.id,{paymentAmount:2000000},undefined,key),patch(row.id,{paymentAmount:2000000},undefined,key)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal((await patch(row.id,{paymentAmount:2000000},undefined,key)).status,200);
  assert.equal((await patch(row.id,{paymentAmount:1000000},undefined,key)).status,409);
  assert.equal((await get(row.id)).finalPaid,2000000);assert.equal((await audits(row.id)).length,1);
  // A full settlement followed by a retry must succeed without adding payment at zero balance.
  const fullKey=crypto.randomUUID();await patch(row.id,{paymentAmount:3000000},undefined,fullKey);
  assert.equal((await patch(row.id,{paymentAmount:3000000},undefined,fullKey)).status,200);
  assert.equal((await get(row.id)).finalPaid,5000000);assert.equal((await audits(row.id)).length,2);
});

test('partial G: distinct concurrent requests revalidate latest balance and cannot overpay', async () => {
  const row=await booking({advance:0});
  const responses=await Promise.all([patch(row.id,{paymentAmount:3000000}),patch(row.id,{paymentAmount:3000000})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal((await get(row.id)).finalPaid,3000000);assert.equal((await audits(row.id)).length,1);
});

test('partial H: audit failure rolls back delta; retry with same key can succeed', async () => {
  const row=await booking(),key=crypto.randomUUID();auditFailure=true;
  try {assert.equal((await patch(row.id,{paymentAmount:2000000},undefined,key)).status,500);}finally{auditFailure=false;}
  assert.equal((await get(row.id)).finalPaid,0);assert.equal((await audits(row.id)).length,0);
  assert.equal((await patch(row.id,{paymentAmount:2000000},undefined,key)).status,200);assert.equal((await get(row.id)).finalPaid,2000000);
});

test('partial I: cancelled and returned marker/lineage reject delta payments',async()=>{
  for(const mode of ['cancelled','Цуцлагдсан','marker','lineage']) {
    const row=await booking(mode==='lineage'?{}:{status:mode==='marker'?'cancelled':mode,advance:0,capacitySlot:null});
    if(mode==='marker') await pg.query('update bookings set returned_to_preorder_at=now() where id=$1',[row.id]);
    if(mode==='lineage') await pg.query("insert into pre_bookings(customer,phone,vehicle,manufacture_year,source,status,returned_from_booking_id) values('Fixture','99112233','Toyota',2020,'manual','new',$1)",[row.id]);
    assert.equal((await patch(row.id,{paymentAmount:1})).status,409);assert.equal((await get(row.id)).finalPaid,0);assert.equal((await audits(row.id)).length,0);
  }
});
