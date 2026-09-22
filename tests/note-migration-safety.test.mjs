import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../drizzle/0014_booking_notes.sql',import.meta.url),'utf8');
const preflight=readFileSync(new URL('../docs/sql/0014_booking_notes_preflight.sql',import.meta.url),'utf8');
const verification=readFileSync(new URL('../docs/sql/0014_booking_notes_verification.sql',import.meta.url),'utf8');
async function fixture() {
 const pg=new PGlite();
 await pg.exec(`
 CREATE TABLE bookings(id serial PRIMARY KEY, booking_no text NOT NULL, programming_completed boolean DEFAULT false, programming_completed_at timestamptz, programming_completed_by jsonb, installation_completed boolean DEFAULT false, installation_completed_at timestamptz, installation_completed_by jsonb, handover_completed boolean DEFAULT false, handover_completed_at timestamptz, handover_completed_by jsonb);
 CREATE TABLE pre_bookings(id serial PRIMARY KEY, note text NOT NULL DEFAULT '', converted_booking_id integer, status text DEFAULT 'new', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
 CREATE TABLE audit_logs(id serial PRIMARY KEY); CREATE TABLE service_visits(id serial PRIMARY KEY);
 INSERT INTO bookings(booking_no) VALUES ('GE-test');
 INSERT INTO pre_bookings(note,converted_booking_id) VALUES ('Legacy unchanged',1),('',null);
 CREATE ROLE gas_app_runtime NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
 ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO gas_app_runtime, anon, authenticated;
 ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO gas_app_runtime, anon, authenticated;
 `);return pg;
}
async function source(pg){return [(await pg.query('select * from bookings order by id')).rows,(await pg.query('select * from pre_bookings order by id')).rows];}

test('final migration and read-only SQL execute locally; source data unchanged, FK/index/RLS/ACL/trigger checks pass',async()=>{
 const pg=await fixture();try{
  const before=await source(pg);const pre=await pg.exec(preflight);
  assert.ok(pre.flatMap(r=>r.rows||[]).filter(r=>'present_and_correct' in r).every(r=>r.present_and_correct));
  assert.deepEqual(await source(pg),before);
  await pg.exec(migration);assert.deepEqual(await source(pg),before);
  const results=(await pg.exec(verification)).flatMap(r=>r.rows||[]);
  assert.ok(results.filter(r=>'pass' in r).every(r=>r.pass));
  assert.ok(results.filter(r=>'valid_and_ready' in r).every(r=>r.valid_and_ready));
  assert.equal(results.find(r=>'exact_expected_policies' in r).exact_expected_policies,true);
  assert.deepEqual(results.find(r=>'update_delete_protection' in r),{update_delete_protection:true,truncate_protection:true});
  assert.equal(results.find(r=>'two_restrict_foreign_keys' in r).two_restrict_foreign_keys,true);
  assert.equal(results.find(r=>'missing_or_mismatched_legacy_notes_must_be_zero' in r).missing_or_mismatched_legacy_notes_must_be_zero,0);
  assert.equal(results.find(r=>'inherited_notes_visible_to_bookings' in r).inherited_notes_visible_to_bookings,1);
  for(const r of results.filter(r=>r.rolname==='gas_app_runtime' && 'grant_option' in r))assert.equal(r.allowed,['SELECT','INSERT'].includes(r.op));
  for(const r of results.filter(r=>['anon','authenticated'].includes(r.rolname) && 'allowed' in r))assert.equal(r.allowed,false);
 }finally{await pg.close();}
});

test('append-only rejects UPDATE/DELETE/TRUNCATE; direct FKs reject owner deletes; restricted role can insert/read',async()=>{
 const pg=await fixture();try{
  await pg.exec(migration);
  for(const sql of ["update booking_notes set note='lost'",'delete from booking_notes','truncate booking_notes'])await assert.rejects(()=>pg.exec(sql),/append-only/);
  await assert.rejects(()=>pg.exec('delete from pre_bookings where id=1'),/foreign key/);
  await pg.exec('SET ROLE gas_app_runtime');
  await pg.exec(`insert into booking_notes(booking_id,note,created_by) values(1,'Direct','{"id":null,"name":"Test","role":"admin"}')`);
  assert.equal((await pg.query('select count(*) from booking_notes')).rows[0].count,2);
  for(const sql of ["update booking_notes set note='lost'",'delete from booking_notes','truncate booking_notes'])await assert.rejects(()=>pg.exec(sql),/permission denied/);
  await pg.exec('RESET ROLE');await assert.rejects(()=>pg.exec('delete from bookings where id=1'),/foreign key/);
 }finally{await pg.close();}
});

test('rerun fails before mutations; rollback preserves successful first install without duplicated backfill',async()=>{
 const pg=await fixture();try{
  await pg.exec(migration);const before=await source(pg);const notes=(await pg.query('select * from booking_notes')).rows;
  await assert.rejects(()=>pg.exec(migration),/0014 object already exists/);await pg.exec('ROLLBACK');
  assert.deepEqual(await source(pg),before);assert.deepEqual((await pg.query('select * from booking_notes')).rows,notes);
 }finally{await pg.close();}
});

test('oversized legacy text aborts whole migration and preserves original source rows',async()=>{
 const pg=await fixture();try{
  await pg.query('update pre_bookings set note=$1 where id=1',['x'.repeat(2001)]);const before=await source(pg);
  await assert.rejects(()=>pg.exec(migration),/check constraint/);await pg.exec('ROLLBACK');
  assert.equal((await pg.query("select to_regclass('public.booking_notes') as obj")).rows[0].obj,null);assert.deepEqual(await source(pg),before);
 }finally{await pg.close();}
});

test('unsafe inherited runtime grants fail closed and roll back DDL/backfill without shared ACL changes',async()=>{
 const pg=await fixture();try{
  await pg.exec('CREATE ROLE excessive_runtime NOLOGIN; GRANT excessive_runtime TO gas_app_runtime; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO excessive_runtime;');
  const before=await source(pg);
  await assert.rejects(()=>pg.exec(migration),/excessive inherited/);await pg.exec('ROLLBACK');
  assert.equal((await pg.query("select to_regclass('public.booking_notes') as obj")).rows[0].obj,null);assert.deepEqual(await source(pg),before);
 }finally{await pg.close();}
});
