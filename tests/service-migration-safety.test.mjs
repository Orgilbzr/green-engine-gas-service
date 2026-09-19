import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../drizzle/0013_service_process.sql', import.meta.url), 'utf8');
const setup = async () => {
 const db = new PGlite();
 await db.exec(`CREATE TABLE bookings(id serial PRIMARY KEY, booking_no text NOT NULL, customer text, manufacture_year smallint, total_price integer, status text);
 INSERT INTO bookings(booking_no,customer,manufacture_year,total_price,status) VALUES ('GE-OLD-1','Existing',NULL,0,'Дууссан'),('GE-OLD-2','Cancelled',2020,5000000,'Цуцлагдсан');`);
 return db;
};
test('0013 preserves every legacy field, supports old inserts, validates new visit constraints', async () => {
 const db = await setup();
 try {
  const before = (await db.query('select * from bookings order by id')).rows;
  await db.exec(migration);
  const after = (await db.query('select * from bookings order by id')).rows;
  for (const [i,row] of after.entries()) {
   for (const key of Object.keys(before[i])) assert.deepEqual(row[key],before[i][key]);
   for(const step of ['programming','installation','handover']){assert.equal(row[`${step}_completed`],false);assert.equal(row[`${step}_completed_at`],null);assert.equal(row[`${step}_completed_by`],null);}
  }
  await db.exec("insert into bookings(booking_no) values ('OLD-APP-INSERT')");
  assert.equal((await db.query("select programming_completed from bookings where booking_no='OLD-APP-INSERT'")).rows[0].programming_completed,false);
  const insert = "insert into service_visits(booking_id,booking_no,visited_at,purpose,branch,recorded_by) values ($1,'GE-OLD-1',now(),$2,'16-ын салбар',$3)";
  await assert.rejects(()=>db.query(insert,[999,'programming','{}']),e=>e.code==='23503');
  await assert.rejects(()=>db.query(insert,[1,'invalid','{}']),e=>e.code==='23514');
  await assert.rejects(()=>db.query(insert,[1,'programming',null]),e=>e.code==='23502');
  await db.query(insert,[1,'programming','{"name":"Test","role":"operator","id":1}']);
  await db.query(insert,[1,'installation','{"name":"Test","role":"operator","id":1}']);
  assert.equal((await db.query('select count(*)::int as count from service_visits')).rows[0].count,2);
  const indexes=(await db.query("select indexname from pg_indexes where tablename='service_visits'")).rows.map(r=>r.indexname);
  assert.ok(indexes.includes('service_visits_booking_idx'));assert.ok(indexes.includes('service_visits_pkey'));
  await db.exec('delete from bookings where id=1');assert.equal((await db.query('select count(*)::int as count from service_visits where booking_id is null')).rows[0].count,2);
 } finally { await db.close(); }
});
test('0013 rerun fails safely at duplicate column and preserves first-run data after ROLLBACK',async()=>{
 const db=await setup();try{
  await db.exec(migration);await db.exec('update bookings set programming_completed=true where id=1');
  await assert.rejects(()=>db.exec(migration),e=>e.code==='42701');
  await db.exec('ROLLBACK');assert.equal((await db.query('select programming_completed from bookings where id=1')).rows[0].programming_completed,true);
  assert.equal((await db.query('select count(*)::int as count from bookings')).rows[0].count,2);
 }finally{await db.close();}
});
test('0013 late DDL failure rolls back earlier column additions without changing old data',async()=>{
 const db=await setup();try{
  await db.exec('create table service_visits(existing_marker text)');
  await assert.rejects(()=>db.exec(migration),e=>e.code==='42P07');await db.exec('ROLLBACK');
  assert.equal((await db.query("select count(*)::int as count from information_schema.columns where table_name='bookings' and column_name='programming_completed'")).rows[0].count,0);
  assert.equal((await db.query('select count(*)::int as count from bookings')).rows[0].count,2);
 }finally{await db.close();}
});
