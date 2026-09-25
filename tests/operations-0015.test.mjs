import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(path, imports = {}) {
  const context = { exports: {}, require: name => imports[name] ?? require(name) };
  vm.runInNewContext(compile(path), context, { filename: path });
  return context.exports;
}

const { returnIneligibleReason } = load('../app/booking-return.ts');
const candidate = { status: 'Хүлээгдэж буй', advance: 0, finalPaid: 0,
  programmingCompleted: false, installationCompleted: false, handoverCompleted: false };

test('return eligibility rejects every service and payment condition independently', () => {
  assert.equal(returnIneligibleReason(candidate, false, false), null);
  assert.match(returnIneligibleReason(candidate, true, false), /Ирэлт/);
  for (const field of ['programmingCompleted','installationCompleted','handoverCompleted'])
    assert.match(returnIneligibleReason({ ...candidate, [field]: true }, false, false), /Үйлчилгээ/);
  for (const field of ['advance','finalPaid'])
    assert.match(returnIneligibleReason({ ...candidate, [field]: 1 }, false, false), /Төлбөр/);
  assert.match(returnIneligibleReason(candidate, false, true), /Идэвхгүй/);
  assert.match(returnIneligibleReason({ ...candidate, status: 'cancelled' }, false, false), /Идэвхгүй/);
  assert.match(returnIneligibleReason({ ...candidate, status: 'Дууссан' }, false, false), /Идэвхгүй/);
});

test('0015 lineage queries expose each ancestor note once and hide soft-deleted notes', async () => {
  const pg = new PGlite();
  try {
    // A local query fixture, not execution of migration 0015.
    await pg.exec(`
      create table bookings(id integer primary key,booking_no text);
      create table pre_bookings(id integer primary key,converted_booking_id integer,parent_pre_booking_id integer,returned_from_booking_id integer);
      create table booking_notes(id integer primary key,booking_id integer,pre_booking_id integer,
        note text,created_at timestamptz,created_by jsonb,legacy boolean,deleted_at timestamptz);
      insert into bookings values (10,'A'),(20,'B'),(30,'C');
      insert into pre_bookings values (1,10,null,null),(2,20,1,10),(3,30,2,20);
      insert into booking_notes values
        (1,null,1,'Preorder A','2026-01-01','{}',false,null),
        (2,10,null,'Booking A','2026-01-02','{}',false,null),
        (3,null,2,'Preorder B','2026-01-03','{}',false,null),
        (4,20,null,'Booking B','2026-01-04','{}',false,null),
        (5,null,3,'Preorder C','2026-01-05','{}',false,null),
        (6,30,null,'Booking C','2026-01-06','{}',false,null),
        (7,10,null,'Deleted','2026-01-07','{}',false,'2026-01-08');`);
    const engine = drizzle(pg);
    // postgres-js execute returns rows directly; PGlite wraps them in { rows }.
    const db = { execute: async query => (await engine.execute(query)).rows };
    const notes = load('../db/notes.ts', {
      '.': { getHealthyDb: async () => db }, './schema': {}, '../app/audit': {},
      '../app/operations-0015': { operations0015Enabled: async () => true },
    });
    const preorderHistory = await notes.readNotes(db, 'preorders', 3);
    assert.deepEqual(preorderHistory.map(row => row.note),
      ['Booking C','Preorder C','Booking B','Preorder B','Booking A','Preorder A']);
    const bookingHistory = await notes.readNotes(db, 'bookings', 30);
    assert.deepEqual(bookingHistory.map(row => row.id), preorderHistory.map(row => row.id));
    const [summary] = await notes.withNoteSummaries(db, 'preorders', [{ id: 3 }]);
    assert.equal(summary.noteCount, 6);
    assert.equal(summary.latestNote, 'Booking C');
    const [bookingSummary] = await notes.withNoteSummaries(db, 'bookings', [{ id: 30 }]);
    assert.equal(bookingSummary.noteCount, 6);
    assert.equal(bookingSummary.latestNote, 'Booking C');
  } finally { await pg.close(); }
});

test('note delete control belongs only to editable timeline; confirmation and compact return action exist', () => {
  const notes = load('../app/NoteHistory.tsx', { './note-history': { noteDate: () => '2026.09.22 · 15:30' } });
  const one = [{ id: 1, note: '5 сая орж ирсэн', createdAt: '2026-09-22', createdBy: { name: 'orgil bzr' }, legacy: false }];
  const readonly = renderToStaticMarkup(React.createElement(notes.NoteTimeline, { notes: one }));
  const editable = renderToStaticMarkup(React.createElement(notes.NoteTimeline, { notes: one, onDelete() {} }));
  assert.doesNotMatch(readonly, /note-delete/);
  assert.match(editable, /aria-label="Тэмдэглэл устгах"/);
  assert.match(editable, /5 сая орж ирсэн/);
  const source = readFileSync(new URL('../app/NoteHistory.tsx', import.meta.url), 'utf8');
  assert.match(source, /Энэ тэмдэглэлийг устгах уу\?/);
  assert.match(source, /method: "DELETE"/);
  assert.doesNotMatch(source, /tx\.delete\(/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<BookingActionMenu/);
  assert.match(page, /Урьдчилсан руу буцаах/);
});

test('editable booking table keeps seven fixed columns inside desktop widths', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const blocks = [
    css.slice(css.indexOf('@media(min-width:721px) {'), css.indexOf('@media(min-width:721px) and (max-width:1200px)')),
    css.slice(css.indexOf('@media(min-width:721px) and (max-width:1200px)'), css.indexOf('@media(min-width:721px) and (max-width:1100px)')),
    css.slice(css.indexOf('@media(min-width:721px) and (max-width:1100px)'), css.indexOf('@media(max-width:720px)', css.indexOf('@media(min-width:721px) and (max-width:1100px)'))),
  ];
  for (const [width, block] of [[1440, blocks[0]], [1280, blocks[0]], [1024, blocks[2]]]) {
    const cols = [...block.matchAll(/table\.has-actions th:nth-child\((\d)\) \{ width:(\d+)%; \}/g)];
    assert.equal(cols.length, 7, `${width}px column count`);
    assert.equal(cols.reduce((sum, match) => sum + Number(match[2]), 0), 100, `${width}px width sum`);
  }
  assert.match(css, /\.booking-more-menu:popover-open \{[^}]*position:fixed;/);
  assert.match(css, /\.booking-more-menu:popover-open \{[^}]*max-width:calc\(100vw - 16px\)/);
});
