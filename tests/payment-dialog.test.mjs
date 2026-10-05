import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function load(path){const exports={};new Function('exports','require',compile(path))(exports,name=>name.startsWith('.')?load(new URL(name+'.ts',new URL(path,import.meta.url)).href):require(name));return exports;}
const metrics=load('../app/dashboard-metrics.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const nodes=(node,type)=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(n=>nodes(n,type)):[...(node.type===type?[node]:[]),...nodes(node.props?.children,type)];
function modal(respond) {
  let cursor=0,rc=0,closed=0;
  const states=[],refs=[],requests=[],updates=[];
  const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=v;}];},useRef(initial){return refs[rc++]??={current:initial};},useEffect(){}};
  const exports={};
  new Function('exports','require','fetch','crypto',compile('../app/PaymentDialog.tsx'))(exports,name=>name==='react'?hooks:name==='./dashboard-metrics'?metrics:name.endsWith('.css')?{}:require(name),async(url,options)=>{requests.push({url,body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return respond?respond():Response.json({booking:{id:1,finalPaid:2000000}});},crypto);
  const render=()=>{cursor=rc=0;return exports.default({booking:{id:1,bookingNo:'GE-1',totalPrice:5000000,advance:1000000,finalPaid:0},onClose(){closed++;},onPaid(b){updates.push(b);}});};
  const input=()=>nodes(render(),'input')[0];
  const button=text=>nodes(render(),'button').find(b=>String(b.props.children).includes(text));
  const submit=()=>nodes(render(),'form')[0].props.onSubmit({preventDefault(){}});
  return{render,input,button,submit,requests,updates,closed:()=>closed,fill(value){input().props.onChange({target:{value}});}};
}

test('modal shows total/paid/balance and full-balance shortcut fills without sending',()=>{
  const ui=modal();assert.deepEqual(nodes(ui.render(),'dd').map(n=>n.props.children),['5,000,000₮','1,000,000₮','4,000,000₮']);
  assert.equal(ui.input().props.value,'');ui.button('Бүх үлдэгдэл').props.onClick();assert.equal(ui.input().props.value,'4000000');assert.equal(ui.requests.length,0);
});
test('invalid empty/zero/negative/fraction/string/over-balance do not send requests',async()=>{
  const ui=modal();for(const value of['','0','-1','1.5','invalid','2,000,000','5000000']){ui.fill(value);await ui.submit();assert.equal(nodes(ui.render(),'p').some(p=>p.props.role==='alert'),true);}
  assert.equal(ui.requests.length,0);
});
test('Enter/form submits delta only, ref blocks rapid double submit, success updates and closes',async()=>{
  let resolve;const ui=modal(()=>new Promise(r=>{resolve=r;}));ui.fill('2000000');
  const first=ui.submit();await ui.submit();assert.equal(ui.requests.length,1);assert.deepEqual(ui.requests[0].body,{paymentAmount:2000000});assert.match(ui.requests[0].key,/^[0-9a-f-]{36}$/);
  assert.equal(ui.input().props.disabled,true);assert.equal(ui.button('Болих').props.disabled,true);
  nodes(ui.render(),'dialog')[0].props.onCancel({preventDefault(){}});assert.equal(ui.closed(),0);
  resolve(Response.json({booking:{id:1,finalPaid:2000000}}));await first;assert.equal(ui.updates[0].finalPaid,2000000);assert.equal(ui.closed(),1);
});
test('API/network error remains in dialog and same-amount retry uses same request key',async()=>{
  let calls=0;const ui=modal(()=>++calls===1?Promise.reject(new Error('Failed to fetch')):Response.json({error:'Үлдэгдэл өөрчлөгдсөн байна.'},{status:409}));ui.fill('1000000');await ui.submit();await ui.submit();
  assert.equal(ui.requests[0].key,ui.requests[1].key);assert.equal(ui.closed(),0);assert.equal(nodes(ui.render(),'p').find(p=>p.props.role==='alert').props.children,'Үлдэгдэл өөрчлөгдсөн байна.');
});
test('Escape and Cancel close idle dialog without a payment',async()=>{
  const ui=modal();nodes(ui.render(),'dialog')[0].props.onCancel({preventDefault(){}});ui.button('Болих').props.onClick();await tick();assert.equal(ui.closed(),2);assert.equal(ui.requests.length,0);
});
