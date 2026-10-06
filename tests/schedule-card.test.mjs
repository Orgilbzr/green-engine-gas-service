import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const exports = {};
new Function('exports', 'require', ts.transpileModule(readFileSync(new URL('../app/ScheduleBookingCard.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(exports, require);
const booking = { id: 1, time: '09:00', plate: '3991УАХ', vehicle: 'Alpard10', phone: '99007272', bookingNo: 'GE-261005-000066', branch: 'Нарт', customer: 'Customer', status: 'Баталгаажсан' };
test('card renders identifiers and accessible phone, omits internal metadata and preserves data/action', () => {
  const before = structuredClone(booking);
  let calls = 0;
  const card = exports.default({ booking, canEdit: true, onAction: () => calls++ });
  const html = renderToStaticMarkup(card);
  for (const text of ['09:00', '3991УАХ', 'Alpard10', '99007272', 'Хуваарь өөрчлөх']) assert.ok(html.includes(text));
  for (const text of [booking.bookingNo, booking.branch, booking.customer, 'Үндсэн захиалга']) assert.ok(!html.includes(text));
  assert.match(html, /href="tel:99007272"/);
  assert.match(html, /aria-label="99007272 руу залгах"/);
  const action = card.props.children.at(-1);
  assert.equal(action.type, 'button');
  action.props.onClick(); assert.equal(calls, 1);
  assert.deepEqual(booking, before);
});
test('absent phone renders no phone row or placeholder', () => {
  for (const phone of ['', '   ', undefined, null]) {
    const html = renderToStaticMarkup(exports.default({ booking: { ...booking, phone }, canEdit: true, onAction() {} }));
    assert.ok(!html.includes('schedule-phone')); assert.ok(!html.includes('tel:'));
  }
});
test('readonly role retains service process action and long Cyrillic/Latin models', () => {
  for (const vehicle of ['Машины маш урт загвар '.repeat(8), 'Toyota Alphard Hybrid '.repeat(8)]) {
    const html = renderToStaticMarkup(exports.default({ booking: { ...booking, vehicle, plate: '1234ABC' }, canEdit: false, onAction() {} }));
    assert.ok(html.includes(vehicle)); assert.ok(html.includes('1234ABC')); assert.ok(html.includes('Үйлчилгээний явц'));
  }
});
