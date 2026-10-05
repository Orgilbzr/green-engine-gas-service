import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function store({ value = null, readBlocked = false, writeBlocked = false } = {}) {
  const events = new Map();
  const window = {
    localStorage: {
      getItem: key => { assert.equal(key, 'sidebarCollapsed'); if (readBlocked) throw Error('blocked'); return value; },
      setItem: (key, next) => { assert.equal(key, 'sidebarCollapsed'); if (writeBlocked) throw Error('blocked'); value = next; },
    },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); },
  };
  const exports = {};
  const source = readFileSync(new URL('../app/sidebar-state.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { window, exports });
  return { ...exports, events, value: () => value };
}

test('SSR stays expanded while the browser restores only an explicit true value', () => {
  for (const value of [null, 'false', 'bad', 'true']) {
    const state = store({ value });
    assert.equal(state.getServerSidebarCollapsed(), false);
    assert.equal(state.getSidebarCollapsed(), value === 'true');
  }
});

test('toggle persists both states, notifies the UI, and survives a fresh store', () => {
  const state = store();
  let updates = 0;
  const unsubscribe = state.subscribeSidebarCollapsed(() => updates++);
  state.toggleSidebarCollapsed();
  assert.equal(state.value(), 'true');
  assert.equal(store({ value: state.value() }).getSidebarCollapsed(), true);
  state.toggleSidebarCollapsed();
  assert.equal(state.value(), 'false');
  assert.equal(updates, 2);
  unsubscribe();
  state.toggleSidebarCollapsed();
  assert.equal(updates, 2);
  assert.equal(state.events.size, 0);
});

test('blocked reads or writes use expanded default and a usable in-memory toggle', () => {
  for (const options of [{ readBlocked: true }, { writeBlocked: true }]) {
    const state = store(options);
    assert.equal(state.getSidebarCollapsed(), false);
    state.toggleSidebarCollapsed();
    assert.equal(state.getSidebarCollapsed(), true);
    state.toggleSidebarCollapsed();
    assert.equal(state.getSidebarCollapsed(), false);
  }
});

test('cross-tab updates and storage clearing notify subscribers without unrelated keys', () => {
  const state = store();
  let updates = 0;
  const unsubscribe = state.subscribeSidebarCollapsed(() => updates++);
  const event = state.events.get('storage');
  event({ key: 'other' });
  event({ key: 'sidebarCollapsed' });
  event({ key: null });
  assert.equal(updates, 2);
  unsubscribe();
});
