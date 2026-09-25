import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const between = (start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `Missing ${end}`);
  return source.slice(from, to);
};
const functionFrom = (start, end, name, bindings) =>
  new Function(...Object.keys(bindings), `${compile(between(start, end))}; return ${name};`)(...Object.values(bindings));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

function productLoader(status = 'idle', request = () => Promise.resolve({ products: [] })) {
  const requestRef = { current: null };
  const refreshRef = { current: false };
  const updates = { status: [], products: [], calls: 0 };
  const loadProducts = functionFrom('  const loadProducts = async ', '  const loadPreOrders = async ', 'loadProducts', {
    productsRequestRef: requestRef,
    productsRefreshPendingRef: refreshRef,
    productsStatus: status,
    AbortController,
    DOMException,
    setProductsStatus: value => updates.status.push(value),
    setProducts: value => updates.products.push(value),
    fetchWithTimeout: (url, signal) => {
      assert.equal(url, '/api/products');
      assert.equal(signal instanceof AbortSignal, true);
      updates.calls++;
      return request();
    },
    console,
  });
  return { loadProducts, requestRef, refreshRef, updates };
}

function openForm(loadProducts, canEdit = true, date, branch) {
  const updates = { forms: [], views: [], notices: [] };
  const openNew = functionFrom('  const openNew = (', '  const visible = useMemo(', 'openNew', {
    canEdit, loadProducts, iso: () => '2026-09-25', branches: ['Main'],
    emptyForm: day => ({ date: day }),
    setForm: update => updates.forms.push(update),
    setNotice: value => updates.notices.push(value),
    setView: value => updates.views.push(value),
  });
  openNew(date, branch);
  return updates;
}

test('header and calendar buttons use openNew, which starts the guarded loader', async () => {
  assert.match(between('          {canEdit && (\n            <button', '        </header>'), /view === "preorders" \? setPreorderModalOpen\(true\) : openNew\(\)/);
  assert.match(between('<button className="day-free"', '</button>'), /openNew\(date, branch\)/);
  const loader = productLoader();
  const header = openForm(loader.loadProducts);
  const calendar = openForm(loader.loadProducts, true, '2026-09-27', 'Branch');
  assert.equal(loader.updates.calls, 1);
  assert.deepEqual(header.views, ['new']);
  assert.deepEqual(calendar.forms[0], { date: '2026-09-27' });
  assert.equal(calendar.forms[1]({ date: '2026-09-27' }).branch, 'Branch');
  assert.deepEqual(loader.updates.status, ['loading']);
  await Promise.resolve();
});

test('sidebar and mobile paths route through changeView and openNew once', () => {
  assert.match(between('  const navigation = (', '  return (\n    <main'), /changeView\("new"\)/);
  assert.match(between('<nav className="mobile-bottom-nav"', '</nav>'), /changeView\("new"\)/);
  let opens = 0, menuClosed = false;
  const changeView = functionFrom('  function changeView(', '  const navigation = (', 'changeView', {
    setMobileMenuOpen: value => { menuClosed = value === false; },
    openNew: () => { opens++; }, loadPreOrders: () => {}, loadUsers: () => {},
    loadProducts: () => {}, setView: () => {}, setNotice: () => {},
  });
  changeView('new');
  assert.equal(opens, 1);
  assert.equal(menuClosed, true);
});

test('rapid opens share one in-flight request, including ordinary form opens', async () => {
  const response = deferred();
  const loader = productLoader('idle', () => response.promise);
  openForm(loader.loadProducts);
  openForm(loader.loadProducts);
  loader.loadProducts();
  assert.equal(loader.updates.calls, 1);
  response.resolve({ products: [{ id: 1, name: 'Test' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loader.updates.status, ['loading', 'loaded']);
  assert.equal(loader.requestRef.current, null);
});

test('loaded products are reused on form open, while explicit refresh fetches again', async () => {
  const loader = productLoader('loaded');
  openForm(loader.loadProducts);
  assert.equal(loader.updates.calls, 0);
  await loader.loadProducts(true);
  assert.equal(loader.updates.calls, 1);
  assert.deepEqual(loader.updates.status, ['loading', 'loaded']);
});

test('product mutation success explicitly refreshes; in-flight refresh is queued once', async () => {
  const save = between('  async function saveProduct(', '  async function changeProduct(');
  const change = between('  async function changeProduct(', '  async function createPreorder(');
  assert.match(save, /void loadProducts\(true\)/);
  assert.match(change, /if \(r\.ok\) void loadProducts\(true\)/);
  const first = deferred();
  const loader = productLoader('idle', () => loader.updates.calls === 1 ? first.promise : Promise.resolve({ products: [] }));
  const initial = loader.loadProducts();
  await loader.loadProducts(true);
  await loader.loadProducts(true);
  assert.equal(loader.updates.calls, 1);
  first.resolve({ products: [] });
  await initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loader.updates.calls, 2);
  assert.deepEqual(loader.updates.status, ['loading', 'loaded', 'loading', 'loaded']);
});

function productField(status, products = []) {
  const jsx = between('                  <Field label="Бүтээгдэхүүн *">', '                  <Field label="Нийт үнэ">');
  const rendered = ts.transpileModule(`const element = (${jsx.trim()});`, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const html = new Function('React', 'productsStatus', 'products', 'form', 'setForm', 'money', 'Field', 'ResourceNotice',
    `${rendered}; return element;`)(
      React, status, products, { productId: '' }, () => {}, new Intl.NumberFormat('mn-MN'),
      ({ children }) => React.createElement('label', null, children),
      ({ message, onRetry }) => React.createElement('div', null, message, React.createElement('button', { onClick: onRetry }, 'Дахин оролдох')),
    );
  return renderToStaticMarkup(html);
}

test('idle is neutral; loading, loaded and error/retry are distinct', () => {
  assert.match(productField('idle'), /Бүтээгдэхүүн бэлдэж байна/);
  assert.doesNotMatch(productField('idle'), /Бүтээгдэхүүн ачаалж байна/);
  assert.match(productField('loading'), /Бүтээгдэхүүн ачаалж байна/);
  assert.match(productField('loaded', [{ id: 7, name: 'Product', price: 100, active: true }]), /Product/);
  assert.match(productField('error'), /Бүтээгдэхүүнийг ачаалж чадсангүй/);
  assert.match(productField('error'), /Дахин оролдох/);
});

test('non-editing roles do not start product loading through openNew', () => {
  let calls = 0;
  openForm(() => calls++, false);
  assert.equal(calls, 0);
});
