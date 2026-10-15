import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../app/NavigationDrawer.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/sidebar.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const effects=[];
const dialog={shown:0,closed:0,querySelector(){return null;},showModal(){this.shown++;},close(){this.closed++;}};
const media={matches:true, addEventListener(_event,callback){this.callback=callback;},removeEventListener(){this.callback=null;}};
const body={style:{overflow:'auto'}};
let restoredFocus=0;
const opener={focus(options){assert.equal(options.preventScroll,true);restoredFocus++;}};
const exports={};
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('exports','require','window','document',code)(exports,name=>name==='react'?{useRef:()=>({current:dialog}),useEffect:callback=>effects.push(callback)}:name==='react/jsx-runtime'?jsxRuntime:(()=>{throw Error(name);})(),{matchMedia:query=>{assert.equal(query,'(width < 1200px)');return media;}},{body,activeElement:opener});

test('drawer uses native modal focus containment, Escape/backdrop/X and restores scroll on desktop resize',()=>{
  let closed=0;
  const element=exports.default({children:React.createElement('nav',null,'Navigation'),onClose:()=>closed++});
  const markup=renderToStaticMarkup(element);
  assert.match(markup,/id="navigation-drawer"/);
  assert.match(markup,/aria-labelledby="navigation-drawer-title"/);
  assert.match(markup,/aria-label="Цэс хаах"/);
  assert.match(markup,/<nav>Navigation<\/nav>/);
  const cleanup=effects.pop()();
  assert.equal(dialog.shown,1); assert.equal(body.style.overflow,'hidden');
  element.props.onClose();
  assert.equal(closed,1);
  const target={};element.props.onClick({target,currentTarget:target});assert.equal(closed,2);
  element.props.onClick({target:{},currentTarget:target});assert.equal(closed,2);
  media.matches=false;media.callback();assert.equal(closed,3);
  cleanup();assert.equal(dialog.closed,1);assert.equal(body.style.overflow,'auto');assert.equal(restoredFocus,1);
  exports.default({children:null,onClose:()=>closed++});effects.pop()();
  assert.equal(dialog.shown,1);assert.equal(closed,4);
});

test('drawer reuses all navigation and keeps desktop branding and the collapsed preference',()=>{
  assert.match(page,/<nav aria-label="Drawer навигаци">\{navigation\}<\/nav>/);
  assert.match(page,/className="menu-toggle"[^]*?aria-expanded=\{mobileMenuOpen\}/);
  assert.match(page,/function changeView[^]*?setMobileMenuOpen\(false\)/);
  assert.match(css,/@media \(width < 1200px\)/);
  assert.match(css,/\.app-shell \.sidebar \{ display:none!important; \}/);
  assert.match(css,/width:min\(280px,100%\)/);
  assert.match(css,/backdrop-filter:blur\(2px\)/);
  assert.match(css,/prefers-reduced-motion:reduce[^]*?animation:none/);
});
