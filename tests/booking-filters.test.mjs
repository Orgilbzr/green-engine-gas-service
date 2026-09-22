import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../app/booking-filters.ts', import.meta.url), 'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS } }).outputText)(exports);
const { matchesBookingFilters: matches } = exports;
const states = [{}, {programmingCompleted:true}, {installationCompleted:true}, {programmingCompleted:true,installationCompleted:true}, {programmingCompleted:true,installationCompleted:true,handoverCompleted:true}, {handoverCompleted:true}, {programmingCompleted:true,handoverCompleted:true}, {installationCompleted:true,handoverCompleted:true}];
const expected = {
  programming:[1,3,4,6], 'programming-pending':[0,2,5,7],
  installation:[2,3,4,7], 'installation-pending':[0,1,5,6],
  // installation done, programming still pending (independent, no fixed order).
  'installed-not-programmed':[2,7],
  // programming done, installation still pending.
  'programmed-not-installed':[1,6],
  // both steps done but not yet handed over.
  'ready-for-handover':[3],
  // both steps done and handed over (the normal, complete path).
  handover:[4],
  // handed over despite an incomplete step — needs operator attention.
  'incomplete-handover':[5,6,7],
};
for (const [filter, indices] of Object.entries(expected)) test(filter, () => {
  assert.deepEqual(states.flatMap((b,i) => matches(b,filter,'',0) ? [i] : []), indices);
});
test('installation completed and programming pending matches installed-not-programmed only', () => {
  assert.equal(matches({installationCompleted:true,programmingCompleted:false}, 'installed-not-programmed', '', 0), true);
  assert.equal(matches({installationCompleted:true,programmingCompleted:true}, 'installed-not-programmed', '', 0), false);
});
test('programming completed and installation pending matches programmed-not-installed only', () => {
  assert.equal(matches({programmingCompleted:true,installationCompleted:false}, 'programmed-not-installed', '', 0), true);
  assert.equal(matches({programmingCompleted:true,installationCompleted:true}, 'programmed-not-installed', '', 0), false);
});
test('ready for handover requires both steps done and handover not yet completed', () => {
  assert.equal(matches({programmingCompleted:true,installationCompleted:true,handoverCompleted:false}, 'ready-for-handover', '', 0), true);
  assert.equal(matches({programmingCompleted:true,installationCompleted:true,handoverCompleted:true}, 'ready-for-handover', '', 0), false);
  assert.equal(matches({programmingCompleted:true,installationCompleted:false,handoverCompleted:false}, 'ready-for-handover', '', 0), false);
});
test('normal handed over requires both steps done and handover completed', () => {
  assert.equal(matches({programmingCompleted:true,installationCompleted:true,handoverCompleted:true}, 'handover', '', 0), true);
  assert.equal(matches({programmingCompleted:true,installationCompleted:false,handoverCompleted:true}, 'handover', '', 0), false);
});
test('incomplete handover warns when handed over with a missing step', () => {
  assert.equal(matches({programmingCompleted:false,installationCompleted:true,handoverCompleted:true}, 'incomplete-handover', '', 0), true);
  assert.equal(matches({programmingCompleted:true,installationCompleted:false,handoverCompleted:true}, 'incomplete-handover', '', 0), true);
  assert.equal(matches({programmingCompleted:true,installationCompleted:true,handoverCompleted:true}, 'incomplete-handover', '', 0), false);
});
const payments = [
  [{totalPrice:100,advance:100},0,['paid']],
  [{totalPrice:100,advance:20},80,['balance']],
  [{totalPrice:100},100,['balance','unpaid']],
  [{totalPrice:100,advance:20,finalPaid:80},0,['paid']],
  [{totalPrice:100,finalPaid:20},80,['balance']],
  [{totalPrice:0},0,['paid']],
  [{totalPrice:100,advance:110},0,['paid']],
];
test('service and payment combine with AND for every state and payment case', () => {
  for (const [service, indices] of Object.entries(expected)) for (const [payment,remaining,allowed] of payments) {
    for (const filter of ['paid','balance','unpaid']) states.forEach((state,i) => {
      assert.equal(matches({...state,...payment},service,filter,remaining),indices.includes(i) && allowed.includes(filter));
    });
  }
});
test('empty filters retain all bookings; balance includes unpaid', () => {
  for (const [b,remaining,allowed] of payments) {
    assert.equal(matches(b,'','',remaining),true);
    for (const filter of ['paid','balance','unpaid']) assert.equal(matches(b,'',filter,remaining),allowed.includes(filter));
  }
});
test('mechanic uses existing redacted payment flags, not missing prices', () => {
  for (const [b,allowed] of [[{advancePaid:false,balancePaid:false},['balance','unpaid']], [{advancePaid:true,balancePaid:false},['balance']], [{advancePaid:false,balancePaid:true},['paid']], [{advancePaid:true,balancePaid:true},['paid']]]) {
    for (const filter of ['paid','balance','unpaid']) assert.equal(matches(b,'',filter,0),allowed.includes(filter));
  }
});
