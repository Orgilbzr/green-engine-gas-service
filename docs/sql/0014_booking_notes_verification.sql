-- READ ONLY: run AFTER manual 0014 COMMIT, before deploying/resuming writes.
-- Save results and compare source row counts/checksums with preflight.
-- If booking_notes is absent or any gate fails: STOP. Do not rerun migration/drop objects.
-- No test INSERT/UPDATE/DELETE/TRUNCATE/nextval or SET ROLE is performed here.
-- Catalog inspection verifies definitions; mutation-denial tests ran only in local PGlite.
-- Owner/superuser can deliberately alter/disable protections; append-only is not an
-- immutable external ledger against a privileged database administrator.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT current_database(),current_user,session_user,current_schema(),current_setting('search_path') AS search_path;
SELECT c.oid::regclass AS relation,pg_get_userbyid(c.relowner) AS owner,c.relkind,
       c.relrowsecurity AS rls_must_be_true,c.relforcerowsecurity AS force_rls_expected_false
FROM pg_class c WHERE c.oid=to_regclass('public.booking_notes');

WITH expected(col,typ,required) AS (VALUES
 ('id','integer',true),('booking_id','integer',false),('pre_booking_id','integer',false),
 ('note','text',true),('created_at','timestamp with time zone',true),('created_by','jsonb',true),('legacy','boolean',true))
SELECT e.*,coalesce(format_type(a.atttypid,a.atttypmod)=e.typ AND a.attnotnull=e.required,false) AS pass,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM expected e LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.booking_notes') AND a.attname=e.col AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum ORDER BY e.col;

SELECT conname,contype,convalidated,pg_get_constraintdef(oid) AS definition,
 CASE WHEN contype='f' THEN confdeltype='r' AND confupdtype='a' AND convalidated ELSE convalidated END AS validated_and_restrict_fk
FROM pg_constraint WHERE conrelid=to_regclass('public.booking_notes') ORDER BY conname;
SELECT
 (SELECT count(*)=2 FROM pg_constraint WHERE conrelid=to_regclass('public.booking_notes') AND contype='f' AND confdeltype='r' AND convalidated
  AND confrelid IN (to_regclass('public.bookings'),to_regclass('public.pre_bookings'))) AS two_restrict_foreign_keys,
 (SELECT count(*)=2 FROM pg_constraint WHERE conrelid=to_regclass('public.booking_notes') AND contype='c' AND convalidated
  AND conname IN ('booking_notes_owner_check','booking_notes_text_check')) AS both_check_constraints,
 (SELECT count(*)=1 FROM pg_constraint WHERE conrelid=to_regclass('public.booking_notes') AND contype='p') AS primary_key;

-- Confirm key order: owner ID, created_at DESC, id DESC; conversion index on converted_booking_id.
WITH expected(name) AS (VALUES ('booking_notes_pkey'),('booking_notes_booking_idx'),('booking_notes_prebooking_idx'),('pre_bookings_converted_booking_idx'))
SELECT e.name,coalesce(i.indisvalid AND i.indisready,false) AS valid_and_ready,
 pg_get_indexdef(i.indexrelid) AS definition
FROM expected e LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.'||e.name) ORDER BY e.name;
SELECT pg_get_serial_sequence('public.booking_notes','id') AS id_sequence;

SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,
       t.tgfoid=to_regprocedure('public.reject_booking_note_mutation()') AS correct_function
FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.booking_notes') AND NOT t.tgisinternal;
SELECT
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes') AND tgname='booking_notes_immutable'
  AND tgtype=27 AND tgenabled IN ('O','A') AND tgfoid=to_regprocedure('public.reject_booking_note_mutation()')) AS update_delete_protection,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes') AND tgname='booking_notes_no_truncate'
  AND tgtype=34 AND tgenabled IN ('O','A') AND tgfoid=to_regprocedure('public.reject_booking_note_mutation()')) AS truncate_protection;
SELECT p.oid::regprocedure,p.prosecdef AS security_definer_expected_false,p.proconfig,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p WHERE p.oid=to_regprocedure('public.reject_booking_note_mutation()');

SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='booking_notes' ORDER BY policyname;
SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='gas_app_runtime') THEN
 (SELECT count(*)=2 AND bool_and(roles=ARRAY['gas_app_runtime']::name[] AND permissive='PERMISSIVE' AND
   ((policyname='booking_notes_read' AND cmd='SELECT' AND qual='true' AND with_check IS NULL)
    OR (policyname='booking_notes_insert' AND cmd='INSERT' AND qual IS NULL AND with_check='true')))
  FROM pg_policies WHERE schemaname='public' AND tablename='booking_notes')
 ELSE NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='booking_notes') END AS exact_expected_policies;

-- gas_app_runtime: SELECT/INSERT true only; all other table operations false.
-- anon/authenticated: all false. Owner/service_role administrative access is separate.
SELECT r.rolname,v.op,has_table_privilege(r.oid,to_regclass('public.booking_notes'),v.op) AS allowed,
 has_table_privilege(r.oid,to_regclass('public.booking_notes'),v.op||' WITH GRANT OPTION') AS grant_option
FROM pg_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(op)
WHERE r.rolname IN ('gas_app_runtime','anon','authenticated',current_user) ORDER BY r.rolname,v.op;
SELECT r.rolname,v.op,has_sequence_privilege(r.oid,to_regclass('public.booking_notes_id_seq'),v.op) AS allowed
FROM pg_roles r CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) v(op)
WHERE r.rolname IN ('gas_app_runtime','anon','authenticated',current_user) ORDER BY r.rolname,v.op;
SELECT r.rolname, r.rolsuper,r.rolbypassrls,
 has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
 has_function_privilege(r.oid,to_regprocedure('public.reject_booking_note_mutation()'),'EXECUTE') AS direct_function_execute
FROM pg_roles r WHERE r.rolname IN ('gas_app_runtime','anon','authenticated',current_user);
SELECT c.relname,c.relacl FROM pg_class c
WHERE c.oid IN (to_regclass('public.booking_notes'),to_regclass('public.booking_notes_id_seq'));

-- All anomaly counts must be ZERO. Legacy import count must equal preflight legacy_note_count.
SELECT count(*) AS total_notes,count(*) FILTER (WHERE legacy) AS imported_legacy_notes,
 count(*) FILTER (WHERE num_nonnulls(booking_id,pre_booking_id)<>1) AS invalid_owners,
 count(*) FILTER (WHERE created_at IS NULL OR created_by IS NULL) AS missing_metadata
FROM public.booking_notes;
SELECT count(*) AS missing_or_mismatched_legacy_notes_must_be_zero FROM public.pre_bookings p
WHERE length(btrim(p.note))>0 AND NOT EXISTS
 (SELECT 1 FROM public.booking_notes n WHERE n.pre_booking_id=p.id AND n.legacy AND n.note=p.note);
SELECT count(*) AS duplicate_legacy_owners_must_be_zero FROM
 (SELECT pre_booking_id FROM public.booking_notes WHERE legacy GROUP BY pre_booking_id HAVING count(*)<>1) duplicates;
SELECT count(*) AS orphaned_note_references_must_be_zero FROM public.booking_notes n
WHERE (n.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id))
 OR (n.pre_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id));
SELECT count(*) AS dangling_conversion_links_must_be_zero FROM public.pre_bookings p
WHERE p.converted_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id);
SELECT count(*) AS inherited_notes_visible_to_bookings FROM public.booking_notes n
JOIN public.pre_bookings p ON p.id=n.pre_booking_id JOIN public.bookings b ON b.id=p.converted_booking_id;
-- Exact source rows must match preflight while writes remain paused. No raw PII output.
SELECT 'bookings' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(b)::text),'' ORDER BY id),'')) AS data_checksum FROM public.bookings b
UNION ALL
SELECT 'pre_bookings',count(*),md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id),'')) FROM public.pre_bookings p;
COMMIT;
