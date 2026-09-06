import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url), root=new URL('../',import.meta.url);
let queries=0, inserted, updated;
const current={id:1,branch:'16-ын салбар',bookingDate:'2026-09-01',bookingTime:'09:00',status:'Хүлээгдэж буй',capacitySlot:1,manufactureYear:null};
const product={id:1,name:'test',price:5000000,active:true};
const db={select:()=>({from:()=>({where:()=>({limit:async()=>[selectedProduct?product:current]})})}),insert:()=>({values:values=>{inserted=values;return {returning:async()=>[{id:2,...values}]};}}),update:()=>({set:values=>{updated=values;return {where:()=>({returning:async()=>[{...current,...values}]})};}})};
let selectedProduct=false;
const modules=new Map();
function load(file){
 const url=new URL(file,root);if(modules.has(url.href))return modules.get(url.href);
 const exports={};const code=ts.transpileModule(readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const loader=name=>{
  if(name.endsWith('/authz'))return {requireRole:async()=>({user:{id:1,email:'test@example.invalid',role:'admin'}})};
  if(name.endsWith('/db'))return {getHealthyDb:async()=>{queries++;return db;},createRequestDiagnostics:()=>({stage(){}}),logSlowOperation(){},isDatabaseConnectionError:()=>false,safeErrorResponse:()=>Response.json({error:'safe'},{status:500})};
  if(name.endsWith('/audit'))return {writeAuditLog:async()=>{},createChangeSet:()=>({})};
  if(name.endsWith('/booking-capacity'))return {withBookingCapacity:async(db,cb)=>cb(db),findAvailableCapacitySlot:async()=>1,bookingWithCapacitySlot:(values,slot)=>({...values,capacitySlot:slot})};
  if(name.endsWith('/booking-duplicates'))return {normalizePlate:v=>v.trim().toUpperCase().replace(/\s/g,''),checkBookingDuplicates:async()=>({}),duplicateResponse:()=>null};
  if(!name.startsWith('.'))return require(name);
  return load(new URL(name+'.ts',url).href);
 };
 new Function('exports','require','process',code)(exports,loader,{env:{NODE_ENV:'production'}});modules.set(url.href,exports);return exports;
}
const v=load('app/input-validation.ts');
const booking={customer:'Test',phone:'+976 9911-2233',plate:'1234 уба',vehicle:'Toyota',manufactureYear:2020,branch:'16-ын салбар',date:'2026-09-01',time:'09:00',productId:1,advance:0};
const req=(body,method='POST')=>new Request('https://gas.ecoauto.app/api/test',{method,headers:{origin:'https://gas.ecoauto.app','content-type':'application/json'},body:JSON.stringify(body)});
const ctx=id=>({params:Promise.resolve({id})});

test('invalid booking payloads return safe 400 before product or capacity queries',async()=>{
 const route=load('app/api/bookings/route.ts');
 for(const override of [{customer:'x'.repeat(121)},{advanceNote:'x'.repeat(201)},{receipt:'x'.repeat(201)},{phone:'++++'},{phone:'123abc456'},{plate:'<script>'},{manufactureYear:1949},{manufactureYear:[2020]},{advance:-1},{advance:'NaN'},{advance:'Infinity'},{advance:'1e7'},{advance:2147483648},{date:'2026-02-30'},{time:'24:00'},{branch:'unknown'},{status:'unknown'},{productId:'1.2'}]) {
  const before=queries;const response=await route.POST(req({...booking,...override}));assert.equal(response.status,400,JSON.stringify(override));assert.equal(queries,before);
 }
});
test('server product record controls price and identity/capacity fields cannot be mass-assigned',async()=>{
 selectedProduct=true;
 const response=await load('app/api/bookings/route.ts').POST(req({...booking,totalPrice:1,finalPaid:123,bookingNo:'EVIL',capacitySlot:99,role:'admin',actorEmail:'EVIL',status:'Дууссан'}));
 assert.equal(response.status,201);assert.equal(inserted.totalPrice,product.price);assert.equal(inserted.finalPaid,0);assert.equal(inserted.capacitySlot,1);assert.equal(inserted.bookingNo,undefined);assert.equal(inserted.actorEmail,undefined);assert.equal(inserted.status,'Хүлээгдэж буй');
 assert.equal(inserted.phone,'97699112233');assert.equal(inserted.plate,'1234УБА');selectedProduct=false;
});
test('all route IDs reject zero, negatives, decimals, exponent strings and overflow before record queries',async()=>{
 for(const file of ['bookings/[id]','preorders/[id]','products/[id]','users/[id]']){
  const route=load('app/api/'+file+'/route.ts');
  for(const id of ['0','-1','1.1','1e2','abc','2147483648']){
   const before=queries;assert.equal((await route.PATCH(req({status:'cancelled',active:false,role:'admin'},'PATCH'),ctx(id))).status,400,file+id);assert.equal(queries,before);
   if(route.DELETE)assert.equal((await route.DELETE(req({},'DELETE'),ctx(id))).status,400);
  }
 }
});
test('legacy NULL manufacture year can be edited without supplying a new year',async()=>{
 const response=await load('app/api/bookings/[id]/route.ts').PATCH(req({finalPaid:100},'PATCH'),ctx('1'));
 assert.equal(response.status,200);assert.equal((await response.json()).booking.manufactureYear,null);assert.equal(updated.manufactureYear,undefined);
});
test('money, year, enums, strings and object shape fail closed without coercing data',()=>{
 for(const value of [NaN,Infinity,-Infinity,-1,{},[],true,'','-1','1.5',' 5','0x10'])assert.throws(()=>v.money(value),v.InputError);
 for(const value of [null,[],true,'json'])assert.throws(()=>v.validateBody(value,'booking'),v.InputError);
 for(const data of [{email:'bad',password:'12345678',role:'admin'},{email:'a@b.c',password:'12345678',role:'root'},{email:'a@b.c',password:'x'.repeat(1025),role:'admin'}])assert.throws(()=>v.validateBody(data,'user'),v.InputError);
 assert.throws(()=>v.validateBody({active:'false'},'user-patch'),v.InputError);
 assert.throws(()=>v.validateBody({note:'x'.repeat(501),...booking},'preorder'),v.InputError);
});
test('public payload excludes security/linkage fields and report filters are bounded',()=>{
 const body=v.validateBody({...booking,convertedBookingId:4,actor:'bad',passwordHash:'bad',sessionToken:'bad'},'preorder');
 for(const key of ['convertedBookingId','actor','passwordHash','sessionToken'])assert.equal(key in body,false);
 const {parseReportQuery,ReportValidationError}=load('app/reports/model.ts');
 for(const value of ['page=1001','pageSize=99999','search='+ 'x'.repeat(101),'branch=unknown','from=2026-02-30','from=1900-01-01&to=2026-01-01','productId=2147483648'])assert.throws(()=>parseReportQuery(new URLSearchParams(value)),ReportValidationError);
});
