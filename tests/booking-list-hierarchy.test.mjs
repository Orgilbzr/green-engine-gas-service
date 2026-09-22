import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const source = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

// Loads a small, dependency-free .ts/.tsx module by transpiling it directly (mirrors the
// pattern used by the other page.tsx-derived tests in this suite).
const moduleCache = new Map();
function loadModule(relPath) {
  const url = new URL(relPath, import.meta.url).href;
  if (moduleCache.has(url)) return moduleCache.get(url);
  const code = readFileSync(fileURLToPath(url), 'utf8');
  const exportsObj = {};
  const relativeRequire = name => {
    if (name.startsWith('.')) return loadModule(new URL(name.endsWith('.ts') || name.endsWith('.tsx') ? name : `${name}.ts`, url).href);
    return require(name);
  };
  new Function('exports', 'require', compile(code))(exportsObj, relativeRequire);
  moduleCache.set(url, exportsObj);
  return exportsObj;
}

const { NotePreview } = loadModule('../app/NoteHistory.tsx');
const { matchesBookingFilters } = loadModule('../app/booking-filters.ts');

// Pull the real BookingTable component (and the small helpers it depends on) straight out
// of page.tsx so the render assertions exercise the actual production markup.
const helpersStart = source.indexOf('const isActiveBooking');
const helpersEnd = source.indexOf('const dateLabel');
const helpersCode = source.slice(helpersStart, helpersEnd);
const bookingTableStart = source.indexOf('function BookingTable({');
const bookingTableEnd = source.indexOf('function EditModal({');
const bookingTableCode = source.slice(bookingTableStart, bookingTableEnd);
const bookingTableModuleCode = `${helpersCode}\n${bookingTableCode}\nexports.default = BookingTable;`;

function renderTable(rows, { role = 'admin', loading = false } = {}) {
  const context = {
    exports: {}, require,
    BookingProgress: () => React.createElement('span', null, 'явц'),
    SectionLoading: () => React.createElement('span', null, 'ачаалж байна'),
    NotePreview,
  };
  vm.runInNewContext(compile(bookingTableModuleCode), context);
  return renderToStaticMarkup(React.createElement(context.exports.default, {
    rows, role, loading,
    onDelete() {}, onNotes() {}, onProcess() {}, onEdit() {}, onComplete() {},
  }));
}

const booking = (overrides = {}) => ({
  id: 1, bookingNo: 'GE-260921-000034', customer: 'Бат-Эрдэнэ', phone: '88021166',
  plate: '5656 ААН', vehicle: 'Toyota Prius 30', manufactureYear: 2010,
  branch: '16-ын салбар', date: '2026-09-22', time: '10:00', status: 'Баталгаажсан',
  totalPrice: 100000, advance: 0, finalPaid: 0, advancePaid: false, balancePaid: false,
  ...overrides,
});

test('customer name and phone are the most prominent identifiers; booking number is secondary', () => {
  const html = renderTable([booking()]);
  assert.match(html, /class="customer-name"[^>]*>Бат-Эрдэнэ/);
  assert.match(html, /class="customer-phone"[^>]*>\s*📞\s*88021166/);
  assert.match(html, /class="booking-number"[^>]*>#GE-260921-000034/);
  // The booking number must render as plain secondary text, never wrapped in a <b>/strong tag.
  assert.doesNotMatch(html, /<b[^>]*>\s*#?GE-260921-000034/);
});

test('phone renders as a clickable tel: link', () => {
  const html = renderTable([booking({ phone: '8802 1166' })]);
  assert.match(html, /<a class="customer-phone" href="tel:88021166">/);
});

test('vehicle model is primary and plate is a strong secondary chip', () => {
  const html = renderTable([booking()]);
  assert.match(html, /class="vehicle-model"[^>]*>Toyota Prius 30/);
  assert.match(html, /class="vehicle-plate"[^>]*>5656 ААН/);
  assert.match(html, />2010</);
});

test('missing manufacture year still renders a clear placeholder', () => {
  const html = renderTable([booking({ manufactureYear: null })]);
  assert.match(html, />Тодорхойгүй</);
});

test('note preview: no notes shows the add-note affordance', () => {
  const html = renderToStaticMarkup(React.createElement(NotePreview, { summary: {}, editable: true, onOpen() {} }));
  assert.match(html, /\+ Тэмдэглэл/);
  assert.doesNotMatch(html, /note-preview-count/);
});

test('note preview: read-only with no notes shows an empty state instead of an affordance', () => {
  const html = renderToStaticMarkup(React.createElement(NotePreview, { summary: {}, editable: false, onOpen() {} }));
  assert.match(html, /Тэмдэглэлгүй/);
});

test('note preview: a single note shows the note text without a +N badge', () => {
  const html = renderToStaticMarkup(React.createElement(NotePreview, { summary: { noteCount: 1, latestNote: 'test test' }, editable: true, onOpen() {} }));
  assert.match(html, /test test/);
  assert.doesNotMatch(html, /note-preview-count/);
});

test('note preview: multiple notes show a +N previous-notes indicator', () => {
  const html = renderToStaticMarkup(React.createElement(NotePreview, { summary: { noteCount: 3, latestNote: 'test test' }, editable: true, onOpen() {} }));
  assert.match(html, /class="note-preview-count"[^>]*>\+2 өмнөх тэмдэглэл/);
});

test('note preview: long notes render inside the clamp container rather than being cut server-side', () => {
  const longNote = 'Урт тэмдэглэл '.repeat(30).trim();
  const html = renderToStaticMarkup(React.createElement(NotePreview, { summary: { noteCount: 1, latestNote: longNote }, editable: true, onOpen() {} }));
  assert.match(html, new RegExp(`class="note-preview-text"[^>]*>${longNote}`));
});

test('service filter: installation done, programming pending', () => {
  assert.equal(matchesBookingFilters({ installationCompleted: true, programmingCompleted: false }, 'installed-not-programmed', '', 0), true);
  assert.equal(matchesBookingFilters({ installationCompleted: true, programmingCompleted: true }, 'installed-not-programmed', '', 0), false);
});

test('service filter: programming done, installation pending', () => {
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: false }, 'programmed-not-installed', '', 0), true);
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: true }, 'programmed-not-installed', '', 0), false);
});

test('service filter: ready for handover', () => {
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: true, handoverCompleted: false }, 'ready-for-handover', '', 0), true);
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: true, handoverCompleted: true }, 'ready-for-handover', '', 0), false);
});

test('service filter: normal handed over', () => {
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: true, handoverCompleted: true }, 'handover', '', 0), true);
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: false, handoverCompleted: true }, 'handover', '', 0), false);
});

test('service filter: incomplete handover warning', () => {
  assert.equal(matchesBookingFilters({ programmingCompleted: false, installationCompleted: true, handoverCompleted: true }, 'incomplete-handover', '', 0), true);
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: false, handoverCompleted: true }, 'incomplete-handover', '', 0), true);
  assert.equal(matchesBookingFilters({ programmingCompleted: true, installationCompleted: true, handoverCompleted: true }, 'incomplete-handover', '', 0), false);
});

// The client-side search predicate straight out of page.tsx's `visible` useMemo.
const visibleBody = source.slice(source.indexOf('const k = search.toLowerCase().trim();'), source.indexOf('}, [bookings, search, serviceFilter, paymentFilter]);'));
const filterVisibleCode = `function filterVisible(bookings, search, serviceFilter, paymentFilter) {\n${visibleBody}\n}\nexports.filterVisible = filterVisible;`;
const filterContext = { exports: {}, require, matchesBookingFilters, balance: b => Math.max(0, (b.totalPrice || 0) - (b.advance || 0) - (b.finalPaid || 0)) };
vm.runInNewContext(compile(filterVisibleCode), filterContext);
const { filterVisible } = filterContext.exports;

const searchBookings = [
  booking({ id: 1, customer: 'Бат-Эрдэнэ', phone: '88021166', plate: '5656 ААН', vehicle: 'Toyota Prius 30', bookingNo: 'GE-260921-000034' }),
  booking({ id: 2, customer: 'Сараа', phone: '99334455', plate: '1234 УБА', vehicle: 'Lexus RX 350', bookingNo: 'GE-260921-000035' }),
];

test('search by phone finds the matching booking only', () => {
  const results = filterVisible(searchBookings, '88021166', '', '');
  assert.deepEqual(results.map(b => b.id), [1]);
});

test('search by plate finds the matching booking only', () => {
  const results = filterVisible(searchBookings, '1234 УБА', '', '');
  assert.deepEqual(results.map(b => b.id), [2]);
});

test('search by vehicle make/model finds the matching booking only', () => {
  const results = filterVisible(searchBookings, 'Lexus', '', '');
  assert.deepEqual(results.map(b => b.id), [2]);
});

test('search by booking number finds the matching booking only', () => {
  const results = filterVisible(searchBookings, 'GE-260921-000035', '', '');
  assert.deepEqual(results.map(b => b.id), [2]);
});

test('desktop table renders one column per data point with the harilcagch header', () => {
  const html = renderTable(searchBookings);
  assert.match(html, /<th>ХАРИЛЦАГЧ<\/th>/);
  assert.match(html, /<th>АВТОМАШИН<\/th>/);
  assert.equal((html.match(/<tbody>/g) || []).length, 1);
  assert.equal((html.match(/data-label="Харилцагч"/g) || []).length, searchBookings.length);
});
