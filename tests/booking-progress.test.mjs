import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const exports = {};
const code = ts.transpileModule(readFileSync(new URL('../app/BookingProgress.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function('exports', 'require', code)(exports, createRequire(import.meta.url));
for (const [name, booking, percent, warning] of [
  ['new', {}, 0, false],
  ['programming first', { programmingCompleted:true }, 33, false],
  ['installation first', { installationCompleted:true }, 33, false],
  ['both services', { programmingCompleted:true, installationCompleted:true }, 67, false],
  ['complete handover', { programmingCompleted:true, installationCompleted:true, handoverCompleted:true }, 100, false],
  ['handover without services', { handoverCompleted:true }, 33, true],
  ['handover without installation', { programmingCompleted:true, handoverCompleted:true }, 67, true],
  ['handover without programming', { installationCompleted:true, handoverCompleted:true }, 67, true],
]) test(name, () => {
  const html = renderToStaticMarkup(React.createElement(exports.default, { booking }));
  assert.ok(html.includes(`aria-valuenow="${percent}"`));
  assert.equal(html.includes('is-warning'), warning);
  assert.equal(html.includes('is-handed-over'), percent === 100);
  for (const [key, label] of [['programming','Программ'], ['installation','Төхөөрөмж'], ['handover','Хүлээлгэн өгсөн']]) {
    assert.ok(html.includes(`${label}: ${booking[key+'Completed'] ? 'дууссан' : 'хүлээгдэж буй'}`));
  }
  assert.doesNotMatch(html, /<(button|input|a)\b/);
});

test('arrival is one indicator and does not contribute to completion percentage', () => {
  for (const [hasArrived, percent] of [[false, 0], [true, 0], [true, 33]]) {
    const booking = { hasArrived, ...(percent ? { installationCompleted: true } : {}) };
    const html = renderToStaticMarkup(React.createElement(exports.default, { booking }));
    assert.ok(html.includes(`Ирсэн: ${hasArrived ? 'дууссан' : 'хүлээгдэж буй'}`));
    assert.equal((html.match(/Ирсэн:/g) || []).length, 1);
    assert.ok(html.includes(`aria-valuenow="${percent}"`));
  }
});
