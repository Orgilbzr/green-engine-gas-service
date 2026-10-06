import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

// Security regression harness: real application modules with synthetic cookies, environment,
// diagnostics and an isolated PostgreSQL database. Never loads .env or connects remotely.
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const pg = new PGlite();
after(() => pg.close());
let database;
let databaseFailure;
const jar = new Map();
const environment = { NODE_ENV: 'production' };
const cache = new Map();
const logs = [];
const quietConsole = { info() {}, warn() {}, error(...args) { logs.push(args); } };
const cookieStore = {
  get: key => jar.get(key),
  set: (key, value, options) => jar.set(key, { value, options }),
  delete: key => jar.delete(key),
};
function load(relative) {
  const url = new URL(relative, root);
  if (cache.has(url.href)) return cache.get(url.href);
  const compiled = { exports: {} };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loader = name => {
    // Phase 1 lifecycle tests isolate the limiter; real limiter coverage is in rate-limit.test.mjs.
    if (name.endsWith('/rate-limit')) return { authenticatedRateLimitIdentity: () => 'test-only', checkPreorderRateLimit: async () => null, clientIp: () => 'test-only', checkRateLimit: async () => ({ release: async () => {} }) };
    if (name === 'next/headers') return { cookies: async () => cookieStore };
    if (!name.startsWith('.')) return require(name);
    const target = new URL(name, url);
    if (target.href === new URL('db', root).href) return {
      getHealthyDb: async () => { if (databaseFailure) throw databaseFailure; return database; },
      createRequestDiagnostics: () => ({ stage() {}, requestId: 'synthetic-request' }),
      logSlowOperation() {}, logDatabaseError() {}, NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
      isDatabaseConnectionError: () => false,
      safeErrorResponse: () => Response.json({ error: 'Түр алдаа гарлаа.' }, { status: 500 }),
      databaseErrorResponse: () => Response.json({ error: 'Түр алдаа гарлаа.' }, { status: 503 }),
    };
    return load(`${target.href}.ts`);
  };
  new Function('exports', 'require', 'process', 'console', code)(compiled.exports, loader, { env: environment }, quietConsole);
  cache.set(url.href, compiled.exports);
  return compiled.exports;
}
const schema = load('db/schema.ts');
database = drizzle(pg,{schema});
for(const file of ['0006_postgres_supabase','0007_preorder_schema','0008_three_booking_capacity','0009_capacity_slots','0010_booking_number_audit','0011_vehicle_year_duplicate_support','0012_require_manufacture_year_for_new_records','0013_service_process','0014_booking_notes']) await pg.exec(readFileSync(new URL(`drizzle/${file}.sql`,root),'utf8'));
const auth=load('app/email-auth.ts');
const password='synthetic-readiness-only';const hash=await auth.hashPassword(password);
for(const role of ['admin','operator','mechanic'])await database.insert(schema.appUsers).values({email:role+'@example.invalid',passwordHash:hash,role,active:true});
await database.insert(schema.products).values({name:'Readiness gas kit',price:5000000,active:true});
const login=async role=>{jar.clear();assert.equal(await auth.loginWithPassword(role+'@example.invalid',password),true);};
const request=(path,method='GET',body)=>new Request('https://gas.ecoauto.app/api/'+path,{method,headers:{origin:'https://gas.ecoauto.app','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const call=async(path,method,body,id)=>load(`app/api/${path}/route.ts`)[method](request(path,method,body),{params:Promise.resolve({id:String(id)})});
const fixture={customer:'Local fixture',phone:'99112233',plate:'1234УБА',vehicle:'Toyota Prius',manufactureYear:2015,branch:'16-ын салбар',date:'2026-10-20',time:'10:00',productId:1,advance:1000000};
let booking;
test('real session operator: preorder conversion, number, price, duplicate/year protection after 0013',async()=>{
 await login('operator');
 let response=await call('preorders','POST',{...fixture,source:'manual'});assert.equal(response.status,201);const pre=(await response.json()).preBooking;
 response=await call('preorders/[id]','POST',fixture,pre.id);assert.equal(response.status,201);booking=(await response.json()).booking;
 assert.match(booking.bookingNo,/^GE-\d{6}-\d{6}$/);assert.equal(booking.totalPrice,5000000);assert.equal(booking.advance,1000000);assert.equal(booking.programmingCompleted,false);
 const visible=await (await call('preorders','GET')).json();assert.equal(visible.preBookings.length,0);
 assert.equal((await call('preorders/[id]','POST',fixture,pre.id)).status,409);
 assert.equal((await call('bookings','POST',fixture)).status,409);
 assert.equal((await call('bookings','POST',{...fixture,plate:'5678УБА',manufactureYear:1940})).status,400);
});
test('process and booking notes GET expose safe, non-negative Server-Timing stages',async()=>{
 await login('operator');
 for(const [path,expected] of [
  ['bookings/[id]/process',['db-preflight','auth-total','auth-session','role-user','booking-query','arrival-query','response','total']],
  ['bookings/[id]/notes',['db-preflight','auth-total','auth-session','role-user','booking-existence','0015-capability','notes-history','transaction-overhead','response','total']],
 ]) {
  const response=await call(path,'GET',undefined,booking.id);assert.equal(response.status,200);
  const header=response.headers.get('Server-Timing');assert.ok(header,path);
  for(const name of expected)assert.match(header,new RegExp(`(?:^|, )${name};dur=\\d+\\.\\d{2}`),`${path}: ${name}`);
  for(const match of header.matchAll(/;dur=([\d.]+)/g))assert.ok(Number.isFinite(Number(match[1]))&&Number(match[1])>=0);
  for(const secret of [fixture.customer,fixture.phone,fixture.plate,booking.bookingNo,'operator@example.invalid'])assert.ok(!header.includes(secret));
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  if(path.endsWith('/notes'))assert.deepEqual((await response.json()).notes,[]);
 }
});
test('real session operator: milestones survive edit, reschedule, payment, cancellation and appear in list',async()=>{
 let response=await call('bookings/[id]/process','PATCH',{action:'step',step:'installation',completed:true},booking.id);assert.equal(response.status,200);
 response=await call('bookings/[id]','PATCH',{branch:'Нарны замын салбар',date:'2026-10-21',time:'11:00',manufactureYear:2016},booking.id);assert.equal(response.status,200);let row=(await response.json()).booking;
 assert.equal(row.installationCompleted,true);assert.equal(row.bookingNo,booking.bookingNo);assert.equal(row.manufactureYear,2016);assert.equal(row.date,'2026-10-21');
 response=await call('bookings/[id]','PATCH',{finalPaid:4000000,status:'Дууссан'},booking.id);assert.equal(response.status,200);row=(await response.json()).booking;assert.equal(row.programmingCompleted,false);assert.equal(row.installationCompleted,true);
 response=await call('bookings/[id]','PATCH',{status:'Цуцлагдсан'},booking.id);assert.equal(response.status,200);row=(await response.json()).booking;assert.equal(row.capacitySlot,null);assert.equal(row.installationCompleted,true);
 const list=await (await call('bookings','GET')).json();assert.equal(list.bookings[0].installationCompleted,true);
});
test('arrival derives from visits and another registration preserves history',async()=>{
 await login('operator');
 const listed=async()=> (await (await call('bookings','GET')).json()).bookings.find(row=>row.id===booking.id);
 assert.equal((await listed()).hasArrived,false);
 const visit={action:'visit.add',date:'2026-10-21',time:'11:00',purpose:'inspection',branch:'Нарны замын салбар',note:'First arrival'};
 let response=await call('bookings/[id]/process','PATCH',visit,booking.id);assert.equal(response.status,200);
 let data=await response.json();assert.equal(data.visits.length,1);const firstId=data.visits[0].id;
 assert.equal((await listed()).hasArrived,true);
 response=await call('bookings/[id]/process','PATCH',{...visit,date:'2026-10-22',note:'Second arrival'},booking.id);assert.equal(response.status,200);
 data=await response.json();assert.equal(data.visits.length,2);
 assert.equal(data.visits.find(row=>row.id===firstId).note,'First arrival');
 assert.equal((await listed()).hasArrived,true);
 const history=await (await call('bookings/[id]/process','GET',undefined,booking.id)).json();
 assert.equal(history.visits,undefined);assert.equal(history.booking.arrivedAt,'2026-10-21T03:00:00.000Z');
 assert.equal(new Set((await database.select().from(schema.serviceVisits)).map(row=>row.id)).size,2);
 const arrival=await (await call('bookings/[id]/process','PATCH',{action:'arrival'},booking.id)).json();
 assert.deepEqual(arrival.visits,data.visits);assert.equal(arrival.booking.arrivedAt,'2026-10-21T03:00:00.000Z');
});
test('real sessions: admin/operator process rights, mechanic read-only and financial redaction, audit admin-only',async()=>{
 for(const role of ['admin','operator']){
  await login(role);assert.equal((await call('bookings/[id]/process','PATCH',{action:'step',step:'programming',completed:role==='admin'},booking.id)).status,200);
 }
 await login('mechanic');
 for(const body of [{action:'arrival'},{action:'step',step:'installation',completed:false},{action:'visit.add'},{action:'visit.edit',visitId:1},{action:'visit.delete',visitId:1}])assert.equal((await call('bookings/[id]/process','PATCH',body,booking.id)).status,403);
 assert.equal((await call('bookings/[id]','PATCH',{finalPaid:0},booking.id)).status,403);
 let response=await call('bookings/[id]/process','GET',undefined,booking.id);assert.equal(response.status,200);let data=await response.json();for(const key of ['totalPrice','advance','finalPaid','receipt'])assert.equal(key in data.booking,false);
 assert.equal((await (await call('bookings','GET')).json()).bookings.find(row=>row.id===booking.id).hasArrived,true);
 assert.equal((await call('audit-logs','GET')).status,403);await login('operator');assert.equal((await call('audit-logs','GET')).status,403);
 await login('admin');response=await call('audit-logs','GET');assert.equal(response.status,200);data=await response.json();
 const actions=data.logs.map(log=>log.action);for(const action of ['preorder.converted','booking.created','booking.rescheduled','booking.payment_updated','booking.cancelled','booking.installation.completed','booking.programming.completed','booking.programming.reverted'])assert.ok(actions.includes(action),action);
 jar.clear();assert.equal((await call('bookings/[id]/process','GET',undefined,booking.id)).status,403);assert.equal((await call('bookings/[id]/process','PATCH',{action:'step',step:'programming',completed:true},booking.id)).status,403);
});

test('advance traces creation/conversion, unrelated edits, delta payment, report KPI and Excel without changing canonical semantics', async () => {
 await login('operator');
 const { PgDialect } = require('drizzle-orm/pg-core');
 const { buildReportQuery } = load('app/reports/query.ts');
 const { createReportWorkbook } = load('app/reports/excel.ts');
 const { unzipSync, strFromU8 } = createRequire(require.resolve('write-excel-file/node'))('fflate');
 for (const [index, flow, advance] of [[0,'direct','1000000'],[1,'conversion','1000000'],[2,'conversion',undefined]]) {
  const date=`2031-01-0${index+1}`;
  const payload={...fixture,phone:`9988000${index}`,plate:`TRACE${index}`,date,advance};
  let response;
  if(flow==='conversion') {
   const preResponse=await call('preorders','POST',{...payload,source:'website'});
   assert.equal(preResponse.status,201);
   const pre=(await preResponse.json()).preBooking;
   response=await call('preorders/[id]','POST',payload,pre.id);
  } else response=await call('bookings','POST',payload);
  assert.equal(response.status,201);
  const created=(await response.json()).booking;
  const expected=advance===undefined?0:1000000;
  const stored=async()=> (await pg.query('select total_price, advance, final_paid from bookings where id=$1',[created.id])).rows[0];
  assert.deepEqual(await stored(),{total_price:5000000,advance:expected,final_paid:0});
  const filters={from:date,to:date,branch:'',status:'',productId:'',source:'',paymentStatus:'',search:''};
  const report=async()=>{
   const {sql,params}=new PgDialect().sqlToQuery(buildReportQuery(filters,1));
   return (await pg.query(sql,params)).rows[0].report;
  };
  let data=await report();
  assert.equal(data.rows[0].advance,expected); assert.equal(data.rows[0].remaining,5000000-expected);
  response=await call('bookings/[id]','PATCH',{time:'11:00'},created.id); assert.equal(response.status,200);
  assert.equal((await stored()).advance,expected);
  // Missing advance on an edit cannot default the existing amount to zero.
  response=await call('bookings/[id]','PATCH',{paymentAmount:2000000},created.id);
  // Delta payments require the existing idempotency key contract.
  assert.equal(response.status,400);
  const paymentRequest=new Request('https://gas.ecoauto.app/api/bookings/'+created.id,{method:'PATCH',headers:{origin:'https://gas.ecoauto.app','content-type':'application/json','Idempotency-Key':`00000000-0000-4000-8000-00000000000${index}`},body:JSON.stringify({paymentAmount:2000000})});
  response=await load('app/api/bookings/[id]/route.ts').PATCH(paymentRequest,{params:Promise.resolve({id:String(created.id)})});
  assert.equal(response.status,200);
  assert.deepEqual(await stored(),{total_price:5000000,advance:expected,final_paid:2000000});
  data=await report();
  assert.equal(data.rows[0].remaining,3000000-expected);
  assert.equal(data.totals.advance,data.rows.reduce((sum,row)=>sum+row.advance,0));
  assert.equal(data.branchSummary[0].advance,expected);
  const files=unzipSync(new Uint8Array(await createReportWorkbook({...data,filters,page:1,pageSize:50})));
  const xml=strFromU8(files['xl/worksheets/sheet2.xml']);
  for(const [cell,value] of [['K2',5000000],['L2',expected],['M2',2000000],['N2',3000000-expected]]) assert.match(xml,new RegExp(`<c[^>]*r="${cell}"[^>]*><v>${value}<\\/v><\\/c>`));
 }
});
