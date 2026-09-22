-- READ ONLY: run in Supabase SQL Editor before 0014. Save every result set.
-- GO only when: source schema checks pass; ALL 0014 objects are absent; no oversized
-- notes/dangling conversion links; runtime architecture is verified; write pause is ready.
-- Existing 0014 objects => STOP and use verification SQL (never rerun/drop blindly).
-- SQL Editor identity is NOT evidence of the application's DATABASE_URL identity.
-- Also run the identity/search_path SELECT below through the actual runtime connection.
-- Allowed architecture: existing table owner runtime OR the provisioned gas_app_runtime
-- with schema USAGE, no elevated flags/membership escalation. Other roles need review.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT current_database(), current_user, session_user, current_schema(),
       current_setting('search_path') AS search_path, current_setting('server_version') AS server_version;

SELECT v.name, to_regclass(v.name) IS NOT NULL AS exists,
       c.relkind, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
FROM (VALUES ('public.bookings'), ('public.pre_bookings'), ('public.audit_logs'),
             ('public.service_visits'), ('public.booking_notes'), ('public.booking_notes_id_seq'),
             ('public.booking_notes_booking_idx'), ('public.booking_notes_prebooking_idx'),
             ('public.pre_bookings_converted_booking_idx')) v(name)
LEFT JOIN pg_class c ON c.oid = to_regclass(v.name);
SELECT to_regprocedure('public.reject_booking_note_mutation()') AS existing_0014_function;

-- All present_and_correct should be true. Existing 0013 is inspected, never run here.
WITH expected(tbl, col, typ) AS (VALUES
 ('bookings','id','integer'), ('bookings','booking_no','text'),
 ('bookings','programming_completed','boolean'), ('bookings','programming_completed_at','timestamp with time zone'), ('bookings','programming_completed_by','jsonb'),
 ('bookings','installation_completed','boolean'), ('bookings','installation_completed_at','timestamp with time zone'), ('bookings','installation_completed_by','jsonb'),
 ('bookings','handover_completed','boolean'), ('bookings','handover_completed_at','timestamp with time zone'), ('bookings','handover_completed_by','jsonb'),
 ('pre_bookings','id','integer'), ('pre_bookings','note','text'), ('pre_bookings','converted_booking_id','integer'),
 ('pre_bookings','status','text'), ('pre_bookings','created_at','timestamp with time zone'), ('pre_bookings','updated_at','timestamp with time zone'))
SELECT e.*, a.atttypid IS NOT NULL AND format_type(a.atttypid,a.atttypmod)=e.typ AS present_and_correct,
       a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM expected e LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||e.tbl) AND a.attname=e.col AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum ORDER BY e.tbl,e.col;

-- Inspect ID PK/uniqueness (each referenced id must be a primary key), existing triggers,
-- indexes/policies, and any pre-existing note-history storage. No statements execute DDL.
SELECT conrelid::regclass AS relation, conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid IN (to_regclass('public.bookings'),to_regclass('public.pre_bookings'),to_regclass('public.booking_notes')) ORDER BY conrelid,conname;
SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('bookings','pre_bookings','booking_notes') ORDER BY tablename,indexname;
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('bookings','pre_bookings','audit_logs','service_visits','booking_notes') ORDER BY tablename,policyname;
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace
AND c.relname IN ('bookings','pre_bookings','booking_notes') AND NOT t.tgisinternal;
SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='booking_notes' ORDER BY ordinal_position;

-- Role/default-ACL inventory. Never display connection strings or secrets.
SELECT oid,rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit,rolcreaterole,rolcreatedb,
       has_schema_privilege(oid,'public','USAGE') AS public_usage,
       has_schema_privilege(oid,'public','CREATE') AS public_create
FROM pg_roles WHERE rolname IN (current_user,'postgres','gas_app_runtime','anon','authenticated','service_role');
SELECT member::regrole AS member,roleid::regrole AS inherits_role,admin_option FROM pg_auth_members
WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('gas_app_runtime','anon','authenticated'))
   OR roleid IN (SELECT oid FROM pg_roles WHERE rolname='gas_app_runtime');
SELECT defaclrole::regrole AS owner,defaclnamespace::regnamespace AS namespace,defaclobjtype,defaclacl
FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user);
SELECT r.rolname,v.tbl,v.op,has_table_privilege(r.oid,to_regclass('public.'||v.tbl),v.op) AS allowed
FROM pg_roles r CROSS JOIN (VALUES ('bookings','SELECT'),('pre_bookings','SELECT'),('pre_bookings','UPDATE'),('audit_logs','INSERT')) v(tbl,op)
WHERE r.rolname IN (current_user,'gas_app_runtime');

-- Aggregates only: save as pre-migration data baseline while application writes are paused.
-- Run these only after source table/column checks above pass; absent sources cause a safe read-only error.
SELECT (SELECT count(*) FROM public.bookings) AS bookings_count,
       (SELECT count(*) FROM public.pre_bookings) AS pre_bookings_count,
       (SELECT count(*) FROM public.pre_bookings WHERE length(btrim(note))>0) AS legacy_note_count,
       (SELECT count(*) FROM public.pre_bookings WHERE length(btrim(note))>2000) AS oversized_notes_must_be_zero,
       (SELECT count(*) FROM public.pre_bookings p WHERE p.converted_booking_id IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id)) AS dangling_links_must_be_zero;
-- Snapshot checksums contain no raw customer data. Compare with verification during the write pause.
SELECT 'bookings' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(b)::text),'' ORDER BY id),'')) AS data_checksum FROM public.bookings b
UNION ALL
SELECT 'pre_bookings',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id),'')) FROM public.pre_bookings p;
COMMIT;
