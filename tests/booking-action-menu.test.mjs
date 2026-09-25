import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/BookingActionMenu.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const exportsObj = {};
new Function('exports', 'require', code)(exportsObj, require);
const { bookingMenuPosition, default: BookingActionMenu } = exportsObj;

test('overflow menu flips above a bottom row and stays inside the right viewport edge', () => {
  const position = bookingMenuPosition({ top: 690, bottom: 722, right: 1260 },
    { width: 228, height: 92 }, { width: 1280, height: 750 });
  assert.deepEqual(position, { left: 1032, top: 592 });
});

test('overflow menu opens below a row when there is room and clamps to the left edge', () => {
  const position = bookingMenuPosition({ top: 60, bottom: 92, right: 70 },
    { width: 228, height: 92 }, { width: 320, height: 640 });
  assert.deepEqual(position, { left: 8, top: 98 });
});

test('menu uses a native auto popover with the same conditional actions', () => {
  const render = canReturn => renderToStaticMarkup(React.createElement(BookingActionMenu, {
    canReturn, onReturn() {}, onDelete() {},
  }));
  const eligible = render(true);
  assert.match(eligible, /popover="auto"/);
  assert.match(eligible, /aria-haspopup="menu"/);
  assert.match(eligible, /Урьдчилсан руу буцаах/);
  assert.match(eligible, /class="delete"[^>]*>Устгах/);
  assert.doesNotMatch(render(false), /Урьдчилсан руу буцаах/);
  assert.match(source, /hidePopover\(\)/);
  assert.match(source, /event\.key === "Escape"/);
});
