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
database = drizzle(pg, { schema });
const auth = load('app/email-auth.ts');
const authz = load('app/authz.ts');
await pg.exec(`
create table app_users (id serial primary key, email text unique not null, password_hash text, role text not null, active boolean not null default true, created_at timestamp default now());
create table login_sessions (id serial primary key, token_hash text unique not null, email text not null, expires_at bigint not null, created_at timestamp default now());
create table pre_bookings (id serial primary key, customer text, phone text, vehicle text, plate text, manufacture_year smallint, source text default 'manual', note text, status text default 'new', converted_booking_id integer, created_at timestamptz default now(), updated_at timestamptz default now());
create table audit_logs (id bigserial primary key, actor_user_id integer, actor_email text, actor_role text, action text, entity_type text, entity_id integer, entity_ref text, details jsonb, created_at timestamp default now());
`);
const password = 'synthetic-test-password-only';
const email = 'staff@example.invalid';
const hash = await auth.hashPassword(password);
await database.insert(schema.appUsers).values({ email, passwordHash: hash, role: 'operator', active: true });
const request = (path, method = 'GET', body, headers = {}) => new Request(`https://example.invalid${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const context = { params: Promise.resolve({ id: '999999' }) };

const protectedMethods = [
 ['users', 'GET', ['admin']], ['users', 'POST', ['admin']], ['users/[id]', 'PATCH', ['admin']],
 ['products', 'GET', ['admin','operator']], ['products', 'POST', ['admin']], ['products/[id]', 'PATCH', ['admin']], ['products/[id]', 'DELETE', ['admin']],
 ['bookings', 'GET', ['admin','operator','mechanic']], ['bookings', 'POST', ['admin','operator']], ['bookings/[id]', 'PATCH', ['admin','operator']], ['bookings/[id]', 'DELETE', ['admin','operator']],
 ['bookings/duplicate-check', 'GET', ['admin','operator']], ['preorders', 'GET', ['admin','operator']], ['preorders/[id]', 'PATCH', ['admin','operator']], ['preorders/[id]', 'POST', ['admin','operator']],
 ['reports', 'GET', ['admin','operator']], ['audit-logs', 'GET', ['admin']], ['me', 'GET', ['admin','operator','mechanic']],
];

test('every protected route rejects anonymous requests and ID tampering before record access', async () => {
 jar.clear();
 for (const [path, method] of protectedMethods) {
  const response = await load(`app/api/${path}/route.ts`)[method](request(`/api/${path}`, method, method === 'GET' ? undefined : {}), context);
  assert.equal(response.status, 403, `${method} ${path}`);
 }
});

test('password hashes are salted and session cookies are random, hashed at rest, and production-hardened', async () => {
 assert.match(hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
 assert.notEqual(hash, await auth.hashPassword(password));
 assert.equal(await auth.loginWithPassword(email, 'wrong-password'), false);
 assert.equal(await auth.loginWithPassword(email, password), true);
 const first = cookieStore.get(auth.SESSION_COOKIE);
 assert.equal(first.value.length, 72);
 assert.deepEqual(first.options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 2592000 });
 const rows = (await pg.query('select token_hash from login_sessions')).rows;
 assert.equal(rows.length, 1);assert.match(rows[0].token_hash, /^[a-f0-9]{64}$/);assert.notEqual(rows[0].token_hash, first.value);
 assert.equal(await auth.loginWithPassword(email, password), true);
 const replacement = cookieStore.get(auth.SESSION_COOKIE);
 assert.notEqual(replacement.value, first.value);
 cookieStore.set(auth.SESSION_COOKIE,first.value,{});assert.equal(await auth.getEmailUser(),null);
 cookieStore.set(auth.SESSION_COOKIE,replacement.value,replacement.options);
 assert.equal((await pg.query('select count(*)::int as count from login_sessions')).rows[0].count, 1, 'login replaces the presented session');
 await auth.clearEmailSession();assert.equal(jar.has(auth.SESSION_COOKIE), false);
 assert.equal((await pg.query('select count(*)::int as count from login_sessions')).rows[0].count, 0, 'logout revokes the replacement session');
});

test('invalid/expired sessions and inactive staff are rejected', async () => {
 cookieStore.set(auth.SESSION_COOKIE, 'synthetic-invalid-token', {});
 assert.equal(await auth.getEmailUser(), null);
 await auth.loginWithPassword(email, password);
 await pg.exec('update login_sessions set expires_at = 0');
 assert.equal(await auth.getEmailUser(), null);
 await auth.loginWithPassword(email, password);
 await pg.exec('update app_users set active = false');
 assert.equal(await authz.getAppUser(), null);
 await pg.exec('update app_users set active = true');
 assert.equal((await authz.getAppUser()).role, 'operator');
});

test('mechanic cannot access financial/management APIs; operator cannot manage users/products/audit', async () => {
 for (const role of ['mechanic','operator']) {
  await pg.query('update app_users set role = $1', [role]);
  for (const [path, method, roles] of protectedMethods.filter(([, , roles]) => !roles.includes(role))) {
   const response = await load(`app/api/${path}/route.ts`)[method](request(`/api/${path}`, method, method === 'GET' ? undefined : {}), context);
   assert.equal(response.status, 403, `${role}: ${method} ${path}`);
   assert.equal(roles.includes(role), false);
  }
 }
 await pg.exec("update app_users set role = 'mechanic'");
 assert.equal((await load('app/api/reports/route.ts').GET(request('/api/reports?format=xlsx'))).status,403);
 const masked = authz.bookingForRole({ totalPrice: 10, advance: 2, finalPaid: 1, receipt: 'synthetic', advanceNote: 'staff-supplied note', customer: 'synthetic' }, 'mechanic');
 for (const key of ['totalPrice','advance','finalPaid','receipt']) assert.equal(key in masked, false);
 assert.equal(masked.advanceNote, 'staff-supplied note', 'characterization: free-text payment notes remain visible');
});

test('password reset revokes the current session; foreign Origin/text/plain behavior is unchanged', async () => {
 await pg.exec("update app_users set role = 'admin'");
 const newPassword = 'synthetic-replacement-password';
 const response = await load('app/api/users/route.ts').POST(request('/api/users','POST',{email,password:newPassword,role:'admin'}));
 assert.equal(response.status,201);
 assert.equal('passwordHash' in (await response.json()).user,false);
 assert.equal(await authz.getAppUser(),null, 'existing session is revoked by password reset');
 assert.equal(await auth.loginWithPassword(email,password),false);
 const login = await load('app/api/auth/login/route.ts').POST(request('/api/auth/login','POST',{email,password:newPassword},{origin:'https://foreign.example.invalid','content-type':'text/plain'}));
 assert.equal(login.status,200, 'characterization, not a security guarantee');
 const logout = await load('app/api/auth/signout/route.ts').GET(request('/api/auth/signout','GET',undefined,{origin:'https://foreign.example.invalid'}));
 assert.equal(logout.status,303);assert.equal(jar.has(auth.SESSION_COOKIE),false);
});

test('admin is hash-only, fails generically, and invalidates sessions on hash rotation/removal', async () => {
 jar.clear();
 environment.ADMIN_PASSWORD = 'synthetic-admin-password';
 const loginRoute = load('app/api/auth/login/route.ts');
 const loginAdmin = () => loginRoute.POST(request('/api/auth/login','POST',{email:authz.ADMIN_EMAIL,password:environment.ADMIN_PASSWORD}));
 const missing = await loginAdmin();
 assert.equal(missing.status,401);
 const failure = await missing.json();
 for (const invalid of ['', 'malformed', '0'.repeat(32)+':zz']) {
  environment.ADMIN_PASSWORD_HASH = invalid;
  const response = await loginAdmin();assert.equal(response.status,401);assert.deepEqual(await response.json(),failure);
 }
 environment.ADMIN_PASSWORD_HASH = await auth.hashPassword(environment.ADMIN_PASSWORD);
 assert.equal((await loginAdmin()).status,200);
 assert.equal((await authz.getAppUser()).role,'admin');
 const oldToken = cookieStore.get(auth.SESSION_COOKIE).value;
 environment.ADMIN_PASSWORD_HASH = await auth.hashPassword('synthetic-rotated-password');
 assert.equal(await authz.getAppUser(),null);
 const wrong = await loginAdmin();assert.equal(wrong.status,401);assert.deepEqual(await wrong.json(),failure);
 assert.equal(await auth.loginWithPassword(authz.ADMIN_EMAIL,'synthetic-rotated-password'),true);
 const rotatedToken = cookieStore.get(auth.SESSION_COOKIE).value;
 cookieStore.set(auth.SESSION_COOKIE,oldToken,{});assert.equal(await authz.getAppUser(),null);
 cookieStore.set(auth.SESSION_COOKIE,rotatedToken,{});
 delete environment.ADMIN_PASSWORD_HASH;
 assert.equal(await authz.getAppUser(),null);
 await auth.clearEmailSession();
 delete environment.ADMIN_PASSWORD;
});

test('disable/reactivate revokes every device and protects the break-glass administrator', async () => {
 const staffPassword = 'synthetic-replacement-password';
 jar.clear();assert.equal(await auth.loginWithPassword(email,staffPassword),true);
 const first = cookieStore.get(auth.SESSION_COOKIE).value;
 jar.clear();assert.equal(await auth.loginWithPassword(email,staffPassword),true);
 const second = cookieStore.get(auth.SESSION_COOKIE).value;
 jar.clear();environment.ADMIN_PASSWORD_HASH=await auth.hashPassword('synthetic-admin-password');
 assert.equal(await auth.loginWithPassword(authz.ADMIN_EMAIL,'synthetic-admin-password'),true);
 const adminToken=cookieStore.get(auth.SESSION_COOKIE).value;
 const patch=load('app/api/users/[id]/route.ts').PATCH;
 const staffId=(await pg.query('select id from app_users where email=$1',[email])).rows[0].id;
 const change=active=>patch(request('/api/users/'+staffId,'PATCH',{active}),{params:Promise.resolve({id:String(staffId)})});
 assert.equal((await change(false)).status,200);
 assert.equal((await pg.query('select count(*)::int as n from login_sessions where email=$1',[email])).rows[0].n,0);
 for(const token of [first,second]){cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal(await authz.getAppUser(),null);}
 assert.equal(await auth.loginWithPassword(email,staffPassword),false);
 cookieStore.set(auth.SESSION_COOKIE,adminToken,{});assert.equal((await change(true)).status,200);
 for(const token of [first,second]){cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal(await authz.getAppUser(),null);}
 assert.equal(await auth.loginWithPassword(email,staffPassword),true);
 cookieStore.set(auth.SESSION_COOKIE,adminToken,{});
 assert.equal((await patch(request('/api/users/0','PATCH',{active:false}),{params:Promise.resolve({id:'0'})})).status,400);
 const [shadow]=await database.insert(schema.appUsers).values({email:authz.ADMIN_EMAIL,passwordHash:hash,role:'mechanic',active:false}).returning();
 assert.equal((await patch(request('/api/users/'+shadow.id,'PATCH',{active:false}),{params:Promise.resolve({id:String(shadow.id)})})).status,400);
 assert.equal((await authz.getAppUser()).role,'admin','explicit protected identity uses its configured hash and lifecycle');
 assert.equal((await load('app/api/users/route.ts').POST(request('/api/users','POST',{email:authz.ADMIN_EMAIL,password:staffPassword,role:'admin'}))).status,400);
});

test('password reset revokes all devices atomically, and failed lifecycle changes roll back', async () => {
 const adminToken=cookieStore.get(auth.SESSION_COOKIE).value;
 const oldPassword='synthetic-replacement-password';
 const tokens=[];
 for(let i=0;i<2;i++){jar.clear();assert.equal(await auth.loginWithPassword(email,oldPassword),true);tokens.push(cookieStore.get(auth.SESSION_COOKIE).value);}
 cookieStore.set(auth.SESSION_COOKIE,adminToken,{});
 const reset=()=>load('app/api/users/route.ts').POST(request('/api/users','POST',{email,password:'synthetic-final-password',role:'admin'}));
 const staffId=(await pg.query('select id from app_users where email=$1',[email])).rows[0].id;
 await pg.exec(`create function reject_audit() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_SENSITIVE_MARKER'; end $$; create trigger reject_audit before insert on audit_logs for each row execute function reject_audit();`);
 assert.equal((await reset()).status,503);
 const failedDisable=await load('app/api/users/[id]/route.ts').PATCH(request('/api/users/'+staffId,'PATCH',{active:false}),{params:Promise.resolve({id:String(staffId)})});
 assert.equal(failedDisable.status,503);
 assert.equal((await pg.query('select active from app_users where id=$1',[staffId])).rows[0].active,true);
 for(const token of tokens){cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal((await authz.getAppUser()).email,email);}
 const retainedHash=(await pg.query('select password_hash from app_users where id=$1',[staffId])).rows[0].password_hash;
 assert.equal(await auth.verifyPassword(oldPassword,retainedHash),true);
 await pg.exec('drop trigger reject_audit on audit_logs; drop function reject_audit();');
 cookieStore.set(auth.SESSION_COOKIE,adminToken,{});assert.equal((await reset()).status,201);
 for(const token of tokens){cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal(await authz.getAppUser(),null);}
 assert.equal(await auth.loginWithPassword(email,oldPassword),false);
 assert.equal(await auth.loginWithPassword(email,'synthetic-final-password'),true);
});

test('legacy hashes remain compatible, malformed hashes fail closed and legacy admin tokens are rejected', async () => {
 const {pbkdf2Sync,createHash}=require('node:crypto');
 const salt='0123456789abcdef0123456789abcdef';
 const legacy=salt+':'+pbkdf2Sync(password,Buffer.from(salt,'hex'),120000,32,'sha256').toString('hex');
 assert.equal(await auth.verifyPassword(password,legacy),true);
 assert.equal(await auth.verifyPassword('wrong-password',legacy),false);
 for(const malformed of ['',salt+':00',salt+':'+'z'.repeat(64),legacy+':extra'])assert.equal(await auth.verifyPassword(password,malformed),false);
 const token=crypto.randomUUID()+crypto.randomUUID();
 await database.insert(schema.loginSessions).values({email:authz.ADMIN_EMAIL,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:Date.now()+100000});
 cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal(await authz.getAppUser(),null);
});

test('logout revokes tokens and is safe for expired, unknown, or absent cookies', async () => {
 const route=load('app/api/auth/signout/route.ts');
 jar.clear();assert.equal(await auth.loginWithPassword(email,'synthetic-final-password'),true);
 const token=cookieStore.get(auth.SESSION_COOKIE).value;
 assert.equal((await route.POST()).status,200);assert.equal(jar.has(auth.SESSION_COOKIE),false);
 cookieStore.set(auth.SESSION_COOKIE,token,{});assert.equal(await authz.getAppUser(),null);
 for(const invalid of [token,'invalid',crypto.randomUUID()+crypto.randomUUID()]){
  cookieStore.set(auth.SESSION_COOKIE,invalid,{});assert.equal((await route.POST()).status,200);assert.equal(jar.has(auth.SESSION_COOKIE),false);
 }
 assert.equal((await route.POST()).status,200);
 assert.equal((await route.GET(request('/api/auth/signout'))).status,303);
});

test('auth failures never log raw errors, credentials, cookies or database parameters', async () => {
 const marker='SYNTHETIC_SENSITIVE_MARKER';
 jar.clear();assert.equal(await auth.loginWithPassword(email,'synthetic-final-password'),true);
 databaseFailure=new Error(marker+' password cookie Authorization DATABASE_URL');
 try {
  const responses=[
   await load('app/api/auth/login/route.ts').POST(request('/api/auth/login','POST',{email,password:marker})),
   await load('app/api/me/route.ts').GET(),
   await load('app/api/auth/signout/route.ts').POST(),
   await load('app/api/users/route.ts').GET(),
  ];
  for(const response of responses){assert.equal(response.status,503);assert.doesNotMatch(await response.text(),new RegExp(marker));}
 } finally { databaseFailure=undefined; }
 assert.ok(logs.length>0);
 for(const [,context] of logs){assert.deepEqual(Object.keys(context).sort(),['category','requestId','route','stage']);}
 const output=JSON.stringify(logs);
 for(const sensitive of [marker,password,email,hash,cookieStore.get(auth.SESSION_COOKIE).value,'DATABASE_URL','Authorization'])assert.equal(output.includes(sensitive),false);
 jar.clear();
});

test('public preorder endpoints reject missing/year/honeypot input and whitelist writable properties', async () => {
 jar.clear();
 for (const path of ['preorder','preorders']) {
  const route = load(`app/api/${path}/route.ts`);
  const body={customer:'synthetic',phone:path==='preorder'?'10000001':'10000002',vehicle:'synthetic',manufactureYear:2020};
  for(const bad of [{}, {...body,manufactureYear:1800}, {...body,honeypot:'filled'}]) assert.equal((await route.POST(request(`/api/${path}`,'POST',bad))).status,400);
  const result=await route.POST(request(`/api/${path}`,'POST',{...body,customer:'x'.repeat(300),status:'converted',convertedBookingId:42,passwordHash:'synthetic',role:'admin',note:'n'.repeat(1000)}));
  assert.equal(result.status,201);
  const row=(await result.json()).preBooking;
  assert.equal(row.customer.length,120);assert.equal(row.note.length,500);
  assert.equal(row.status,'new');assert.equal(row.convertedBookingId,null);
  assert.equal('passwordHash' in row,false);assert.equal('role' in row,false);
  assert.equal((await route.POST(request(`/api/${path}`,'POST',body))).status,429);
 }
});

test('characterization: public phone punctuation-only and public manual source are currently accepted', async () => {
 jar.clear();
 const response=await load('app/api/preorder/route.ts').POST(request('/api/preorder','POST',{customer:'synthetic',phone:'++++',vehicle:'synthetic',manufactureYear:2020,source:'manual'}));
 assert.equal(response.status,201);
 assert.equal((await response.json()).preBooking.source,'manual');
});

test('Excel treats = + - @ prefixes as text and emits no formula or external links', async () => {
 const { createReportWorkbook }=load('app/reports/excel.ts');
 const labels=['=1+1','+1+1','-1+1','@SUM(A1:A2)'];
 const rows=labels.map((value,index)=>({id:index,bookingNo:value,date:'2026-09-01',time:'09:00',branch:value,customer:value,phone:value,plate:value,vehicle:value,manufactureYear:2020,productName:value,totalPrice:1,advance:0,remaining:1,status:value,source:value}));
 const file=await createReportWorkbook({filters:{from:'2026-09-01',to:'2026-09-01'},rows,totals:{count:4,sales:4,advance:0,remaining:4,completed:0,cancelled:0},branchSummary:labels.map(label=>({label,count:1,sales:1,advance:0,remaining:1})),productSummary:labels.map(label=>({label,count:1,sales:1}))});
 const { unzipSync,strFromU8 }=createRequire(require.resolve('write-excel-file/node'))('fflate');
 const files=unzipSync(new Uint8Array(file));
 assert.equal(Object.keys(files).some(name=>name.includes('externalLinks')),false);
 for(const name of ['xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']) assert.doesNotMatch(strFromU8(files[name]),/<f[\s>]/);
 for(const label of labels) assert.ok(strFromU8(files['xl/sharedStrings.xml']).includes(label));
});

test('characterization: generic safeErrorResponse logs the original error object', () => {
 const code=readFileSync(new URL('db/index.ts',root),'utf8');
 const start=code.indexOf('export function safeErrorResponse('),end=code.indexOf('\nexport function logDatabaseError',start);
 const compiled=ts.transpileModule(code.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const output={};const captures=[];
 new Function('exports','getPostgresError','isDatabaseConnectionError','console','NO_STORE_HEADERS',compiled)(output,()=>null,()=>false,{error:(...args)=>captures.push(args)},{});
 const marker=new Error('SYNTHETIC_SENSITIVE_MARKER');
 const response=output.safeErrorResponse(marker,'Аюулгүй алдаа');
 assert.equal(response.status,500);assert.equal(captures[0][1],marker);
});
