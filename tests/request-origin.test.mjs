import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const compile = file => ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function guard(mode='production') {
 const exports={};new Function('exports','process',compile('app/request-origin.ts'))(exports,{env:{NODE_ENV:mode}});return exports.checkRequestOrigin;
}
const request=(method='POST',headers={origin:'https://gas.ecoauto.app'},url='https://gas.ecoauto.app/api/users')=>new Request(url,{method,headers});
test('same-origin mutations and Referer fallback pass; missing, malformed, foreign and deceptive origins fail',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']) {
  assert.equal(guard()(request(method)),null);
  assert.equal(guard()(request(method,{referer:'https://gas.ecoauto.app/path?a=1'})),null);
  for(const origin of ['null','https://evil.invalid','https://gas.ecoauto.app.evil.invalid','https://gas.ecoauto.app/path','https://gas.ecoauto.app@evil.invalid','https://gas.ecoauto.app, https://evil.invalid','garbage']) {
   const rejected=guard()(request(method,{origin,referer:'https://gas.ecoauto.app/'}));
   assert.equal(rejected.status,403);assert.deepEqual(await rejected.json(),{error:'Хүсэлтийг зөвшөөрөх боломжгүй байна.'});
  }
  assert.equal(guard()(request(method,{})).status,403);
 }
});
test('localhost is exact same-origin in development only, never enabled by spoofed production Host',()=>{
 const local=request('POST',{origin:'http://localhost:3000'},'http://localhost:3000/api/users');
 assert.equal(guard('development')(local),null);assert.equal(guard()(local).status,403);
 assert.equal(guard('development')(request('POST',{origin:'http://localhost:4000'},local.url)).status,403);
});
test('foreign internal mutations reject before authentication/database calls',async()=>{
 for(const file of ['products/route.ts','products/[id]/route.ts','bookings/route.ts','bookings/[id]/route.ts','users/route.ts','users/[id]/route.ts','preorders/[id]/route.ts','auth/login/route.ts','auth/signout/route.ts']) {
  const exports={};
  new Function('exports','require',compile('app/api/'+file))(exports,name=>name.endsWith('/request-origin')?{checkRequestOrigin:guard()}:{});
  for(const method of ['POST','PATCH','DELETE']) if(exports[method]) assert.equal((await exports[method](request(method,{origin:'https://evil.invalid'}),{params:Promise.resolve({id:'1'})})).status,403);
 }
});
test('GET logout does not clear session; guarded POST clears it and browser form redirects',async()=>{
 let cleared=0;const exports={};
 new Function('exports','require',compile('app/api/auth/signout/route.ts'))(exports,name=>name.endsWith('/request-origin')?{checkRequestOrigin:guard()}:name.endsWith('/email-auth')?{clearEmailSession:async()=>{cleared++;}}:{NO_STORE_HEADERS:{'Cache-Control':'no-store'}});
 assert.equal((await exports.GET()).status,405);assert.equal(cleared,0);
 assert.equal((await exports.POST(request('POST',{origin:'https://evil.invalid'}))).status,403);assert.equal(cleared,0);
 const response=await exports.POST(request('POST',{origin:'https://gas.ecoauto.app',accept:'text/html'}));
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/login');assert.equal(cleared,1);
 assert.doesNotMatch(read('app/page.tsx'),/href="\/api\/auth\/signout"/);
});
test('production security headers and CSP protect framing without wildcard scripts/connections or unsafe-eval',async()=>{
 const exports={};new Function('exports','process',compile('next.config.ts'))(exports,{env:{NODE_ENV:'production'}});
 const rules=await exports.default.headers();const headers=Object.fromEntries(rules[0].headers.map(x=>[x.key,x.value]));
 assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.equal(headers['X-Frame-Options'],'DENY');
 assert.equal(headers['Referrer-Policy'],'strict-origin-when-cross-origin');assert.match(headers['Permissions-Policy'],/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
 const csp=headers['Content-Security-Policy'];for(const directive of ['default-src','script-src','style-src','img-src','font-src','connect-src','frame-ancestors','base-uri','form-action','object-src'])assert.ok(csp.includes(directive));
 assert.match(csp,/frame-ancestors 'none'/);assert.doesNotMatch(csp,/unsafe-eval|\*/);assert.equal(headers['Strict-Transport-Security'],undefined);
});
