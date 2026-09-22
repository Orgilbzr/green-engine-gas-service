import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
const pg = new PGlite(), db = drizzle(pg), cache = new Map();
after(() => pg.close());
let role = 'admin', failAudit = false;
function load(path) {
 const url = new URL(path, import.meta.url); if (cache.has(url.href)) return cache.get(url.href);
 const exports = {}, require = createRequire(url);
 const loader = name => {
  if (name.endsWith('/db')) return { getHealthyDb: async () => db, NO_STORE_HEADERS: { 'Cache-Control':'no-store' }, createRequestDiagnostics: () => ({ stage() {} }), isDatabaseConnectionError: () => false, logSlowOperation() {}, safeErrorResponse: () => Response.json({error:'Failed'},{status:500}) };
  if (name.endsWith('/authz')) return { getAppUser: async () => role ? { id:role === 'admin' ? null : 1, name:'orgil bzr', email:'test@example.invalid', role } : null, requireRole: async roles => roles.includes(role) ? { user: { id:role === 'admin' ? null : 1, name:'orgil bzr', email:'test@example.invalid', role } } : { response: new Response(null,{status:403}) }, bookingForRole: b => b };
  if (name.endsWith('/rate-limit')) return {checkPreorderRateLimit:async()=>null};
  if (name.endsWith('/audit')) { const real=load(new URL(name+'.ts',url).href); return {...real,writeAuditLog: async args=> {if(failAudit)throw new Error('audit unavailable');return real.writeAuditLog(args);}}; }
  if (name.startsWith('.')) return load(new URL(name+(name.endsWith('.tsx')?'':'.ts'),url).href);
  return require(name);
 };
 const code = ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',code)(exports,loader); cache.set(url.href,exports);return exports;
}
for(const file of ['0006_postgres_supabase','0007_preorder_schema','0008_three_booking_capacity','0009_capacity_slots','0010_booking_number_audit','0011_vehicle_year_duplicate_support','0012_require_manufacture_year_for_new_records','0013_service_process']) await pg.exec(readFileSync(new URL(`../drizzle/${file}.sql`,import.meta.url),'utf8'));
await pg.exec("CREATE ROLE gas_app_runtime NOLOGIN; INSERT INTO pre_bookings(customer,phone,vehicle,manufacture_year,note) VALUES ('Legacy','99111111','Prado',2020,'Утсаар ярьсан. Хар өнгийн Prado.'); INSERT INTO products(name,price) VALUES ('Kit',5000000)");
await pg.exec(readFileSync(new URL('../drizzle/0014_booking_notes.sql',import.meta.url),'utf8'));
const bookingRoutes=load('../app/api/bookings/[id]/notes/route.ts'),preRoutes=load('../app/api/preorders/[id]/notes/route.ts');
const context=id=>({params:Promise.resolve({id:String(id)})});
const req=(body,origin='https://gas.ecoauto.app')=>new Request('https://gas.ecoauto.app/api/notes',{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const read=async(routes,id)=>(await routes.GET(req(),context(id))).json();
const add=(routes,id,note,extra={})=>routes.POST(req({note,...extra}),context(id));
const fixture={customer:'Test',phone:'99112233',plate:'1234УБА',vehicle:'Prado',manufactureYear:2020,branch:'16-ын салбар',date:'2026-10-20',time:'10:00',productId:1,advance:0};
let preId,bookingId;
test('legacy note backfill preserves exact text and flags unknown author/time; DB grants append-only',async()=>{
 const data=await read(preRoutes,1);assert.equal(data.notes.length,1);assert.equal(data.notes[0].legacy,true);assert.equal(data.notes[0].note,'Утсаар ярьсан. Хар өнгийн Prado.');assert.equal(data.notes[0].createdBy.role,'legacy');
 const rights=(await pg.query("select has_table_privilege('gas_app_runtime','booking_notes','SELECT') as read, has_table_privilege('gas_app_runtime','booking_notes','INSERT') as add, has_table_privilege('gas_app_runtime','booking_notes','UPDATE') as edit, has_table_privilege('gas_app_runtime','booking_notes','DELETE') as remove")).rows[0];assert.deepEqual(rights,{read:true,add:true,edit:false,remove:false});
 await assert.rejects(()=>pg.exec("update booking_notes set note='lost'"),/append-only/);await assert.rejects(()=>pg.exec('delete from booking_notes'),/append-only/);
});
test('empty preorder; admin/operator append separate notes; server author/time; newest first; no overwrite',async()=>{
 const response=await load('../app/api/preorders/route.ts').POST(req({...fixture,source:'manual'}));assert.equal(response.status,201);preId=(await response.json()).preBooking.id;
 assert.deepEqual((await read(preRoutes,preId)).notes,[]);
 const before=Date.now();let r=await add(preRoutes,preId,'First',{createdBy:{name:'spoof'},createdAt:'2000-01-01'});assert.equal(r.status,201);let data=await r.json();assert.equal(data.notes.length,1);assert.equal(data.notes[0].createdBy.name,'orgil bzr');assert.equal(data.notes[0].createdBy.id,null);assert.ok(Date.parse(data.notes[0].createdAt)>=before-1000);
 role='operator';await add(preRoutes,preId,'Correction: second');data=await read(preRoutes,preId);assert.deepEqual(data.notes.map(n=>n.note),['Correction: second','First']);assert.equal(data.notes[0].createdBy.id,1);
 assert.equal((await pg.query('select note from pre_bookings where id=$1',[preId])).rows[0].note,'');
 const list=await (await load('../app/api/preorders/route.ts').GET()).json();const row=list.preBookings.find(p=>p.id===preId);assert.equal(row.noteCount,2);assert.equal(row.latestNote,'Correction: second');
 const audit=(await pg.query("select * from audit_logs where action='preorder.note.added' order by id desc limit 1")).rows[0];assert.equal(audit.actor_role,'operator');assert.equal(audit.entity_id,preId);assert.equal(audit.details.note_id,data.notes[0].id);assert.ok(audit.details.created_at);
});
test('actual conversion keeps original note IDs, authors, timestamps; booking + preorder notes remain shared',async()=>{
 const before=(await read(preRoutes,preId)).notes;
 const r=await load('../app/api/preorders/[id]/route.ts').POST(req(fixture),context(preId));assert.equal(r.status,201);const data=await r.json();bookingId=data.booking.id;assert.equal(data.booking.noteCount,2);
 assert.deepEqual((await read(bookingRoutes,bookingId)).notes,before);
 await add(bookingRoutes,bookingId,'Booking follow-up');assert.deepEqual((await read(bookingRoutes,bookingId)).notes.map(n=>n.note),['Booking follow-up','Correction: second','First']);
 await add(preRoutes,preId,'Late preorder follow-up');assert.equal((await read(bookingRoutes,bookingId)).notes.length,4);assert.equal((await read(preRoutes,preId)).notes.length,4);
 const list=await (await load('../app/api/bookings/route.ts').GET()).json();assert.equal(list.bookings[0].noteCount,4);assert.equal(list.bookings[0].latestNote,'Late preorder follow-up');
 assert.equal((await load('../app/api/preorders/[id]/route.ts').POST(req(fixture),context(preId))).status,409);
});
test('mechanic read-only booking history, no preorder access; unauthenticated and bad origin denied',async()=>{
 role='mechanic';assert.equal((await bookingRoutes.GET(req(),context(bookingId))).status,200);assert.equal((await add(bookingRoutes,bookingId,'Denied')).status,403);assert.equal((await preRoutes.GET(req(),context(preId))).status,403);assert.equal((await add(preRoutes,preId,'Denied')).status,403);
 role=null;assert.equal((await bookingRoutes.GET(req(),context(bookingId))).status,403);role='admin';assert.equal((await bookingRoutes.POST(req({note:'Denied'},'https://evil.invalid'),context(bookingId))).status,403);
});
test('validation, missing owner, no edit/delete handlers, and audit failure rolls back note',async()=>{
 for(const value of ['', '  ', 'x'.repeat(2001),null,123,'bad\u0000text'])assert.equal((await add(bookingRoutes,bookingId,value)).status,400);
 assert.equal((await add(bookingRoutes,999,'Missing')).status,404);assert.equal((await bookingRoutes.GET(req(),context('invalid'))).status,400);assert.equal(bookingRoutes.PATCH,undefined);assert.equal(bookingRoutes.DELETE,undefined);
 const before=(await read(bookingRoutes,bookingId)).notes;failAudit=true;assert.equal((await add(bookingRoutes,bookingId,'Rollback')).status,500);failAudit=false;assert.deepEqual((await read(bookingRoutes,bookingId)).notes,before);
 const deletion=new Request('https://gas.ecoauto.app/api/bookings/'+bookingId,{method:'DELETE',headers:{origin:'https://gas.ecoauto.app'}});assert.equal((await load('../app/api/bookings/[id]/route.ts').DELETE(deletion,context(bookingId))).status,409);
});
test('initial internal/public preorder notes become distinct records and correct actor snapshots',async()=>{
 role='operator';let r=await load('../app/api/preorders/route.ts').POST(req({...fixture,phone:'99222222',note:'Internal initial',source:'manual'}));assert.equal(r.status,201);let id=(await r.json()).preBooking.id;let notes=(await read(preRoutes,id)).notes;assert.equal(notes[0].createdBy.role,'operator');assert.equal(notes[0].note,'Internal initial');
 r=await load('../app/api/preorder/route.ts').POST(req({...fixture,phone:'99333333',note:'Public initial',source:'website'}));assert.equal(r.status,201);id=(await r.json()).preBooking.id;notes=(await read(preRoutes,id)).notes;assert.equal(notes[0].createdBy.role,'public');assert.equal(notes[0].note,'Public initial');
});
test('stable same-time ordering uses ID descending; UI date is explicitly Ulaanbaatar; safe multiline rendering',async()=>{
 const {noteDate}=load('../app/note-history.ts');assert.equal(noteDate('2026-09-22T03:45:00Z'),'2026.09.22 · 11:45');
 const {NoteTimeline,NotePreview}=load('../app/NoteHistory.tsx');const notes=(await read(bookingRoutes,bookingId)).notes;
 const html=renderToStaticMarkup(React.createElement(NoteTimeline,{notes}));assert.ok(html.indexOf('Late preorder follow-up')<html.indexOf('First'));assert.match(html,/orgil bzr/);
 assert.match(renderToStaticMarkup(React.createElement(NoteTimeline,{notes:[]})),/Одоогоор тэмдэглэл алга/);
 assert.match(renderToStaticMarkup(React.createElement(NotePreview,{summary:{},editable:true,onOpen(){}})),/\+ Тэмдэглэл/);
 assert.match(renderToStaticMarkup(React.createElement(NotePreview,{summary:{noteCount:3,latestNote:'Preview'},editable:true,onOpen(){}})),/\+2/);
 await pg.exec(`insert into booking_notes(booking_id,note,created_at,created_by) values (${bookingId},'tie-one','2030-01-01','{"id":null,"name":"Test","role":"admin"}'),(${bookingId},'tie-two','2030-01-01','{"id":null,"name":"Test","role":"admin"}')`);
 assert.deepEqual((await read(bookingRoutes,bookingId)).notes.slice(0,2).map(n=>n.note),['tie-two','tie-one']);
});
