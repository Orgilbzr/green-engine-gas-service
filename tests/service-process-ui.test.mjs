import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const model = {};
new Function('exports', compile('../app/service-process.ts'))(model);
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual component's event handlers and effects with deterministic hooks
// and a synthetic API. Route/database integration is covered in service-process.test.mjs.
async function modal({ editable = true, booking = {}, confirm = () => true, respond } = {}) {
  const state = [], refs = [], effects = [], requests = [], confirmations = [], updates = [];
  let cursor = 0, refCursor = 0, mounted = false, current = {
    id: 1, bookingNo: 'GE-1', plate: '1234УБА', branch: '16-ын салбар', date: '2026-09-28', time: '10:00', ...booking,
  };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
    useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; },
    useEffect(effect) { if (!mounted) effects.push(effect); },
  };
  const fetch = async (_url, options) => {
    if (options.method !== 'PATCH') return Response.json({ booking: current, visits: [] });
    const payload = JSON.parse(options.body); requests.push(payload);
    if (respond) return respond(payload);
    const at = '2026-09-28T07:16:00Z';
    current = payload.action === 'arrival' ? { ...current, hasArrived: true, arrivedAt: at }
      : { ...current, [`${payload.step}Completed`]: payload.completed, [`${payload.step}CompletedAt`]: payload.completed ? at : null };
    return Response.json({ booking: current, visits: [] });
  };
  const exports = {};
  new Function('exports', 'require', 'fetch', 'window', compile('../app/ServiceProcess.tsx'))(exports,
    name => name === 'react' ? hooks : name === './service-process' ? model : require(name), fetch,
    { confirm(message) { confirmations.push(message); return confirm(message); } });
  const render = () => {
    cursor = refCursor = 0;
    return exports.default({ initial: current, editable, onClose() {}, onUpdated: booking => updates.push(booking) });
  };
  render(); mounted = true; effects.forEach(effect => effect()); await tick();
  const nodes = (element, type) => {
    if (!element || typeof element !== 'object') return [];
    if (Array.isArray(element)) return element.flatMap(child => nodes(child, type));
    return [...(element.type === type ? [element] : []), ...nodes(element.props?.children, type)];
  };
  return { render, requests, confirmations, updates,
    inputs: () => nodes(render(), 'input'), fieldset: () => nodes(render(), 'fieldset')[0] };
}

test('arrival is a direct click; rapid/repeated clicks cannot submit duplicate requests', async () => {
  const ui = await modal(); const arrival = ui.inputs()[0];
  arrival.props.onChange(); arrival.props.onChange(); await tick();
  assert.deepEqual(ui.requests, [{ action: 'arrival' }]);
  assert.equal(ui.inputs()[0].props.checked, true); assert.equal(ui.inputs()[0].props.disabled, true);
  assert.equal(ui.updates[0].arrivedAt, '2026-09-28T07:16:00Z');
});

test('all three milestones record directly; installation can precede programming and arrival', async () => {
  const ui = await modal();
  for (const [index, step] of [[2, 'installation'], [1, 'programming'], [3, 'handover']]) {
    ui.inputs()[index].props.onChange(); await tick();
    assert.deepEqual(ui.requests.at(-1), { action: 'step', step, completed: true });
    assert.equal(ui.updates.at(-1)[`${step}CompletedAt`], '2026-09-28T07:16:00Z');
    assert.equal(ui.inputs()[0].props.checked, false);
  }
  assert.deepEqual(ui.confirmations, []);
});

for (const [index, step, message] of [[1, 'programming', 'Программ уншуулсныг буцаах уу?'],
  [2, 'installation', 'Төхөөрөмж суурилуулсныг буцаах уу?'], [3, 'handover', 'Хүлээлгэн өгснийг буцаах уу?']]) {
  test(`${step} revert requires deliberate confirmation; cancellation preserves timestamp`, async () => {
    let accepted = false;
    const ui = await modal({ booking: { [`${step}Completed`]: true, [`${step}CompletedAt`]: '2026-09-20T02:00:00Z' }, confirm: () => accepted });
    ui.inputs()[index].props.onChange(); await tick();
    assert.deepEqual(ui.requests, []); assert.deepEqual(ui.confirmations, [message]);
    assert.equal(ui.inputs()[index].props.checked, true);
    accepted = true; ui.inputs()[index].props.onChange(); await tick();
    assert.deepEqual(ui.requests, [{ action: 'step', step, completed: false }]);
    assert.equal(ui.inputs()[index].props.checked, false);
  });
}

test('mechanic sees four states but cannot mutate or trigger revert confirmation', async () => {
  const ui = await modal({ editable: false, booking: { programmingCompleted: true } });
  assert.equal(ui.fieldset().props.disabled, true); assert.equal(ui.inputs().length, 4);
  for (const input of ui.inputs()) input.props.onChange(); await tick();
  assert.deepEqual(ui.requests, []); assert.deepEqual(ui.confirmations, []);
});

test('incomplete handover confirmation is preserved; cancellation is silent and sends no retry', async () => {
  for (const accept of [false, true]) {
    const ui = await modal({ confirm: () => accept, respond: payload => payload.confirmIncomplete
      ? Response.json({ booking: { id: 1, handoverCompleted: true }, visits: [] })
      : Response.json({ error: 'Үргэлжлүүлэх үү?', requiresConfirmation: true }, { status: 409 }) });
    ui.inputs()[3].props.onChange(); await tick();
    assert.equal(ui.requests.length, accept ? 2 : 1);
    assert.deepEqual(ui.confirmations, ['Үргэлжлүүлэх үү?']);
    if (accept) assert.equal(ui.requests[1].confirmIncomplete, true);
    else assert.equal(ui.updates.length, 0);
    assert.equal(ui.fieldset().props.disabled, false);
  }
});
