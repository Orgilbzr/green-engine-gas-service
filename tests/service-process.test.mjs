import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
const queries = [];
const pg = new PGlite(), db = drizzle(pg, { logger: { logQuery(query) { queries.push(query); } } }), cache = new Map();
let role = 'admin', failAudit = false;
function load(path) {
 const url = new URL(path, import.meta.url); if (cache.has(url.href)) return cache.get(url.href);
 const exports = {}, require = createRequire(url);
 const loader = name => {
  if (name.endsWith('/db')) return { getHealthyDb: async () => db, NO_STORE_HEADERS: { 'Cache-Control':'no-store' }, safeErrorResponse: e => { throw e; } };
  if (name.endsWith('/authz')) return { requireRole: async roles => roles.includes(role) ? { user: { id:1, name:'Бат', email:'test@example.com', role } } : { response: new Response(null,{status:403}) }, bookingForRole: (booking, role) => { if(role !== 'mechanic')return booking;const {totalPrice,advance,finalPaid,receipt,...rest}=booking;return rest; } };
  if (name.endsWith('/audit') && failAudit) return { writeAuditLog: async () => { throw new Error('audit unavailable'); } };
  if (name.startsWith('.')) return load(new URL(name+'.ts',url).href);
  return require(name);
 };
 const code = ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',code)(exports,loader); cache.set(url.href,exports);return exports;
}
await pg.exec(readFileSync(new URL('../drizzle/0006_postgres_supabase.sql',import.meta.url),'utf8'));
await pg.exec(`ALTER TABLE bookings ADD COLUMN advance_type text, ADD COLUMN advance_note text NOT NULL DEFAULT '', ADD COLUMN capacity_slot smallint, ADD COLUMN manufacture_year smallint;
INSERT INTO bookings(customer,phone,plate,vehicle,branch,booking_date,booking_time,total_price) VALUES ('Test','99112233','1234УБА','Toyota','16-ын салбар','2026-09-20','10:00',5000000);`);
await pg.exec(readFileSync(new URL('../drizzle/0010_booking_number_audit.sql',import.meta.url),'utf8'));
await pg.exec('CREATE ROLE gas_app_runtime NOLOGIN');
await pg.exec(readFileSync(new URL('../drizzle/0013_service_process.sql',import.meta.url),'utf8'));
const route=load('../app/api/bookings/[id]/process/route.ts'), model=load('../app/service-process.ts');
const context=id=>({params:Promise.resolve({id:String(id)})});
const request=body=>new Request('https://gas.ecoauto.app/api/bookings/1/process',{method:'PATCH',headers:{origin:'https://gas.ecoauto.app','content-type':'application/json'},body:JSON.stringify(body)});
const patch=(body,id=1)=>route.PATCH(request(body),context(id));
const state=async()=> (await pg.query('select * from bookings where id=1')).rows[0];
const step=(step,completed,extra={})=>patch({action:'step',step,completed,...extra});

test('migration preserves old rows and defaults without inferring progress from payment',async()=>{const row=await state();assert.equal(row.total_price,5000000);assert.equal(row.programming_completed,false);assert.equal(row.installation_completed,false);assert.equal(row.handover_completed,false);assert.equal(row.programming_completed_at,null);});
test('restricted runtime role receives RLS access only to new visit storage',async()=>{
 const result=(await pg.query("select has_table_privilege('gas_app_runtime','service_visits','SELECT,INSERT,UPDATE,DELETE') as allowed, has_sequence_privilege('gas_app_runtime','service_visits_id_seq','USAGE') as sequence_allowed")).rows[0];assert.equal(result.allowed,true);assert.equal(result.sequence_allowed,true);
 await pg.exec('SET ROLE gas_app_runtime');assert.equal((await pg.query('select count(*) from service_visits')).rows[0].count,0);await pg.exec('RESET ROLE');
});
test('concurrent arrivals lock before checking visits and create one server-timed visit/audit; retries are no-ops',async()=>{
 queries.length=0;
 const before=Date.now();
 // PGlite serializes transactions on one connection. Also check the actual SQL
 // lock/isolation contract used by PostgreSQL across separate server connections.
 const responses=await Promise.all(Array.from({length:4},()=>patch({action:'arrival',visitedAt:'2000-01-01T00:00:00Z',recordedBy:{name:'spoof'}})));
 assert.ok(responses.every(response=>response.status===200));
 const snapshots=await Promise.all(responses.map(response=>response.json()));
 let data=snapshots[0];assert.equal(data.visits.length,1);
 for(const snapshot of snapshots)assert.deepEqual(snapshot.visits,data.visits);
 const locks=queries.filter(query=>/from "bookings".*for update/.test(query));assert.equal(locks.length,4);
 assert.equal(queries.filter(query=>/set transaction isolation level read committed/.test(query)).length,4);
 let locked=false, checks=0;
 for(const query of queries){
  if(/for update/.test(query))locked=true;
  if(/from "service_visits".*limit/.test(query)){assert.ok(locked,'visit check must follow booking lock');locked=false;checks++;}
 }
 assert.equal(checks,4);
 assert.equal(queries.filter(query=>query.startsWith('insert into "service_visits"')).length,1);
 const visit=data.visits[0];assert.equal(visit.purpose,'other');assert.equal(visit.branch,'16-ын салбар');assert.equal(visit.note,'');
 assert.ok(Date.parse(visit.visitedAt)>=before && Date.parse(visit.visitedAt)<=Date.now());
 assert.equal(visit.recordedBy.name,'Бат');assert.equal(data.booking.arrivedAt,visit.visitedAt);assert.equal(data.booking.hasArrived,true);
 const count=(await pg.query('select count(*) from audit_logs')).rows[0].count;
 assert.equal(count,1);
 role='operator';data=await (await patch({action:'arrival'})).json();role='admin';
 assert.deepEqual(data.visits,[visit]);assert.equal(data.booking.arrivedAt,visit.visitedAt);
 assert.equal((await pg.query('select count(*) from audit_logs')).rows[0].count,count);
 const log=(await pg.query("select * from audit_logs where action='booking.visit.created'")).rows[0];
 assert.equal(log.actor_role,'admin');assert.equal(log.details.change.to.visitedAt,visit.visitedAt);
 // Reset this synthetic fixture so the existing visit CRUD tests retain their baseline.
 await pg.exec('delete from service_visits; delete from audit_logs');
});
test('both orders, actor snapshots, no-op idempotence, reset history and handover priority',async()=>{
 for(const first of ['programming','installation']){
  const second=first==='programming'?'installation':'programming';
  let response=await step(first,true);assert.equal(response.status,200);let data=await response.json();assert.equal(model.processStatus(data.booking).color,first==='programming'?'yellow':'orange');
  assert.ok(!data.booking.hasArrived);assert.equal(data.booking[`${second}Completed`],false);
  assert.equal(data.booking[`${first}CompletedBy`].name,'Бат');assert.equal(data.booking[`${first}CompletedBy`].role,'admin');assert.ok(data.booking[`${first}CompletedAt`]);
  const count=(await pg.query('select count(*) from audit_logs')).rows[0].count;await step(first,true);assert.equal((await pg.query('select count(*) from audit_logs')).rows[0].count,count);
  data=await (await step(second,true)).json();assert.equal(model.processStatus(data.booking).color,'purple');
  data=await (await step('handover',true)).json();assert.equal(model.processStatus(data.booking).color,'blue');assert.ok(data.booking.handoverCompletedAt);assert.equal(data.booking.handoverCompletedBy.name,'Бат');
  assert.equal((await step(first,false)).status,409);
  await step('handover',false);await step(first,false);await step(second,false);
  for(const milestone of [first,second,'handover']){const logs=(await pg.query('select action,details from audit_logs where action=$1 or action=$2',[`booking.${milestone}.completed`,`booking.${milestone}.reverted`])).rows;assert.ok(logs.some(log=>log.action.endsWith('completed')));const reverted=logs.find(log=>log.action.endsWith('reverted'));assert.ok(reverted.details.change.from.at);assert.equal(reverted.details.change.from.by.name,'Бат');}
  assert.equal((await state())[`${first}_completed_at`],null);
 }
 const log=(await pg.query('select * from audit_logs order by id limit 1')).rows[0];assert.equal(log.details.actor_display_name,'Бат');assert.equal(log.details.plate,'1234УБА');assert.equal(log.details.change.from.completed,false);assert.match(log.details.change.to.programmingCompletedAt,/^\d{4}-/);
});
test('incomplete handover needs explicit confirmation and malformed input is rejected',async()=>{
 assert.equal((await step('handover',true)).status,409);assert.equal((await step('handover',true,{confirmIncomplete:true})).status,200);await step('handover',false);
 for(const body of [{action:'step',step:'programming',completed:'true'},{action:'step',step:'bad',completed:true},{action:'bad'},{action:'visit.add',date:'2026-02-30',time:'10:00'}])assert.equal((await patch(body)).status,400);
 assert.equal((await patch({action:'step',step:'programming',completed:true},999)).status,404);
});
test('repeated visits support edit and delete with original recorder and audit history',async()=>{
 const body={action:'visit.add',date:'2026-09-20',time:'10:00',purpose:'programming',branch:'16-ын салбар',note:'First'};
 let data=await (await patch(body)).json();const id=data.visits[0].id;assert.equal(data.visits[0].visitedAt,'2026-09-20T02:00:00.000Z');
 data=await (await patch({...body,date:'2026-09-27',purpose:'installation'})).json();assert.equal(data.visits.length,2);
 role='operator';data=await (await patch({...body,action:'visit.edit',visitId:id,note:'Updated'})).json();assert.equal(data.visits.find(v=>v.id===id).recordedBy.role,'admin');
 assert.equal((await patch({...body,action:'visit.edit',visitId:999})).status,404);
 data=await (await patch({action:'visit.delete',visitId:id})).json();assert.equal(data.visits.length,1);
 const retained=data.visits;data=await (await patch({action:'arrival'})).json();assert.deepEqual(data.visits,retained);assert.equal(data.booking.arrivedAt,retained[0].visitedAt);
 const events=(await pg.query("select action from audit_logs where action like 'booking.visit.%'")).rows.map(r=>r.action);assert.deepEqual(events,['booking.visit.created','booking.visit.created','booking.visit.updated','booking.visit.deleted']);const log=(await pg.query("select details from audit_logs where action='booking.visit.created' limit 1")).rows[0];assert.equal(log.details.change.to.visitedAt,'2026-09-20T02:00:00.000Z');role='admin';
});
test('mechanic can view but cannot mutate; origin checks prevent cross-site writes',async()=>{
 role='mechanic';assert.equal((await patch({action:'arrival'})).status,403);assert.equal((await step('programming',true)).status,403);const response=await route.GET(new Request('https://gas.ecoauto.app'),context(1));const data=await response.json();assert.equal(response.status,200);assert.equal(data.booking.totalPrice,undefined);role='admin';
 const bad=new Request('https://gas.ecoauto.app/api/bookings/1/process',{method:'PATCH',headers:{origin:'https://evil.example'},body:'{}'});assert.equal((await route.PATCH(bad,context(1))).status,403);
});
test('audit failure rolls back process mutation; booking deletion retains visit history',async()=>{
 failAudit=true;cache.delete(new URL('../app/api/bookings/[id]/process/route.ts',import.meta.url).href);const broken=load('../app/api/bookings/[id]/process/route.ts');
 await pg.exec("INSERT INTO bookings(customer,phone,plate,vehicle,branch,booking_date,booking_time,total_price) VALUES ('Arrival rollback','99112233','5678УБА','Toyota','16-ын салбар','2026-09-21','10:00',0)");
 await assert.rejects(()=>broken.PATCH(request({action:'arrival'}),context(2)),/audit unavailable/);assert.equal((await pg.query('select count(*) from service_visits where booking_id=2')).rows[0].count,0);
 await assert.rejects(()=>broken.PATCH(request({action:'step',step:'programming',completed:true}),context(1)),/audit unavailable/);assert.equal((await state()).programming_completed,false);
 await pg.exec('delete from bookings where id=1');const visits=(await pg.query('select * from service_visits')).rows;assert.equal(visits.length,1);assert.equal(visits[0].booking_id,null);assert.ok(visits[0].booking_no);await pg.close();
});

test('badges remain unchanged; compact modal displays timestamps/actors and read-only four steps',()=>{
 const {ProcessBadge,default:ServiceProcess}=load('../app/ServiceProcess.tsx');
 const variants=[ [{},'green','Үндсэн захиалга'],[{programmingCompleted:true},'yellow','Суурилуулалт хүлээж байна'],[{installationCompleted:true},'orange','Программ хүлээж байна'],[{programmingCompleted:true,installationCompleted:true},'purple','Бүрэн дууссан'],[{handoverCompleted:true},'blue','Хүлээлгэн өгсөн'] ];
 for(const [booking,color,label] of variants){const html=renderToStaticMarkup(React.createElement(ProcessBadge,{booking}));assert.ok(html.includes(`process-${color}`));assert.ok(html.includes(label));}
 const html=renderToStaticMarkup(React.createElement(ServiceProcess,{initial:{id:1,bookingNo:'GE-1',plate:'1234УБА',branch:'16-ын салбар',date:'2026-09-27',time:'10:00',programmingCompleted:true,programmingCompletedAt:'2026-09-20T02:00:00Z',programmingCompletedBy:{id:1,name:'Бат',role:'operator'}},editable:false,onClose(){},onUpdated(){}}));
 assert.match(html,/aria-labelledby="service-process-title"/);assert.match(html,/fieldset disabled/);assert.match(html,/Бат/);assert.match(html,/Захиалгын ажилтан/);assert.match(html,/09\/20 · 10:00/);assert.doesNotMatch(html,/<form|Ирэлтийн түүх|Дараагийн товлол|Анхаар:|Ирэлт бүртгэх|service-status|process-badge/);
 const arrived=renderToStaticMarkup(React.createElement(ServiceProcess,{initial:{id:1,bookingNo:'GE-1',plate:'1234УБА',branch:'16-ын салбар',date:'2026-09-27',time:'10:00',hasArrived:true,arrivedAt:'2026-09-28T07:16:00Z',installationCompleted:true,installationCompletedAt:'2026-09-28T07:17:00Z',handoverCompleted:true,handoverCompletedAt:'2026-09-28T07:18:00Z'},editable:false,onClose(){},onUpdated(){}}));
 for(const time of ['09/28 · 15:16','09/28 · 15:17','09/28 · 15:18'])assert.ok(arrived.includes(time));
 assert.doesNotMatch(arrived,/Анхаар:|Дараагийн товлол|Ирэлтийн түүх|process-badge/);
 assert.ok(arrived.indexOf('Ирсэн') < arrived.indexOf('Программ'));
 assert.equal((arrived.match(/class="process-row"/g) || []).length,4);
 assert.match(arrived,/checked=""[^>]*disabled=""[^>]*\/?>|disabled=""[^>]*checked=""[^>]*\/?>/);
});

 test('earliest historical visit supplies arrival time; timestamp uses Mongolia time across midnight',()=>{
 const actor={id:1,name:'Бат',role:'operator'};
 assert.deepEqual(model.arrivalState([]),{hasArrived:false,arrivedAt:null,arrivedBy:null});
 const old={visitedAt:'2026-09-20T02:00:00Z',recordedBy:actor};
 assert.equal(model.arrivalState([{visitedAt:'2026-09-28T07:16:00Z',recordedBy:actor},old]).arrivedAt,'2026-09-20T02:00:00.000Z');
 assert.equal(model.formatProcessTimestamp('2026-09-28T16:05:00Z'),'09/29 · 00:05');
 });
