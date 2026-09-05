import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';

const modules = new Map();
let role = 'admin', queryCount = 0;
const db = new PGlite();
function load(path) {
  const url = new URL(path, import.meta.url);
  if (modules.has(url.href)) return modules.get(url.href);
  const compiled = { exports: {} };
  const localRequire = createRequire(url);
  const mockedRequire = name => {
    if (name === '../../../db') return {
      createRequestDiagnostics: () => ({ stage() {} }), NO_STORE_HEADERS: { 'Cache-Control': 'no-store' },
      getHealthyDb: async () => ({ execute: async query => { queryCount++; const { sql, params } = new PgDialect().sqlToQuery(query); return (await db.query(sql, params)).rows; } }),
      isDatabaseConnectionError: () => false, safeErrorResponse: error => { throw error; },
    };
    if (name === '../../authz') return { requireRole: async roles => roles.includes(role) ? { user: { role } } : { response: Response.json({ error: 'Forbidden' }, { status: 403 }) } };
    if (name.startsWith('.')) return load(new URL(`${name}.ts`, url).href);
    return localRequire(name);
  };
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("module", "exports", "require", code)(compiled, compiled.exports, mockedRequire);
  modules.set(url.href, compiled.exports);
  return compiled.exports;
}
const model = load('../app/reports/model.ts');
const { GET } = load('../app/api/reports/route.ts');
await db.exec(`
  create table products (id integer primary key, name text);
  create table bookings (id integer primary key, booking_no text, booking_date text, booking_time text,
    customer text, phone text, plate text, vehicle text, manufacture_year integer, branch text,
    product_id integer, product_name text, total_price integer, advance integer, final_paid integer, status text);
  create table pre_bookings (id integer primary key, converted_booking_id integer, source text, created_at timestamp);
  insert into products values (1, 'Газ 4'), (2, 'Газ 6');
  insert into bookings values
    (1,'GE-001','2026-09-01','09:00','Бат','00112233','1234 УБА','Toyota',2012,'16-ын салбар',1,'Газ 4',5000000,1000000,0,'Баталгаажсан'),
    (2,'GE-002','2026-09-02','10:00','Саруул','88112233','5678УБА','Lexus',2016,'Нарны замын салбар',2,'Газ 6',6000000,2000000,4000000,'Дууссан'),
    (3,'GE-003','2026-09-03','11:00','Цэцэг','99112233','9999УБА','Honda',null,'16-ын салбар',1,'Газ 4',5000000,0,0,'cancelled'),
    (4,'GE-004','2026-09-04','12:00','=1+1','77112233','7777УБА','Nissan',2020,'3-р салбар',null,'',1000000,0,1000000,'Дууссан'),
    (5,'GE-005','2026-08-31','09:00','Old','11112233','1111УБА','Toyota',2010,'16-ын салбар',1,'Газ 4',5000000,0,0,'Хүлээгдэж буй'),
    (6,'GE-006','2026-10-01','09:00','Future','11112233','2222УБА','Toyota',2010,'16-ын салбар',1,'Газ 4',5000000,0,0,'Хүлээгдэж буй');
  insert into pre_bookings values (1,1,'facebook','2026-08-01'), (2,1,'website','2026-08-02'), (3,2,'website','2026-08-03');
`);

export { db, model, GET };
export const getQueryCount = () => queryCount;
export const setRole = value => { role = value; };
