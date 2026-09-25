-- READ ONLY. Run and save results before considering 0015; do not run 0015 on a failed gate.
-- Compare row counts and checksums with verification while application writes are paused.
-- SQL Editor identity does not prove the application's DATABASE_URL runtime identity.
-- Deployment gate: 0015 changes booking DELETE behavior for linked preorders.
-- Keep old-application writes paused until matching application code is deployed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT current_database(), current_user, session_user, current_setting('search_path') AS search_path;
SELECT v.name, to_regclass(v.name) IS NOT NULL AS exists,
       pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls
FROM (VALUES ('public.bookings'),('public.pre_bookings'),('public.booking_notes'),
             ('public.audit_logs'),('public.service_visits')) v(name)
LEFT JOIN pg_class c ON c.oid = to_regclass(v.name);

-- All source columns must exist with these types. All new columns/functions/indexes
-- must be absent; an unexpected existing object means inspect, never blindly rerun.
WITH expected(tbl,col,typ) AS (VALUES
 ('bookings','id','integer'),('bookings','status','text'),
 ('bookings','advance','integer'),('bookings','final_paid','integer'),
 ('bookings','programming_completed','boolean'),('bookings','installation_completed','boolean'),
 ('bookings','handover_completed','boolean'),('bookings','capacity_slot','smallint'),
 ('pre_bookings','id','integer'),('pre_bookings','converted_booking_id','integer'),
 ('pre_bookings','status','text'),('booking_notes','id','integer'),
 ('booking_notes','booking_id','integer'),('booking_notes','pre_booking_id','integer'),
 ('booking_notes','note','text'),('booking_notes','created_at','timestamp with time zone'),
 ('booking_notes','created_by','jsonb'),('audit_logs','details','jsonb'))
SELECT e.*,coalesce(format_type(a.atttypid,a.atttypmod)=e.typ,false) AS pass
FROM expected e LEFT JOIN pg_attribute a
 ON a.attrelid=to_regclass('public.'||e.tbl) AND a.attname=e.col AND NOT a.attisdropped
ORDER BY e.tbl,e.col;
SELECT table_name,column_name AS unexpected_0015_column
FROM information_schema.columns WHERE table_schema='public' AND
 ((table_name='booking_notes' AND column_name IN ('deleted_at','deleted_by'))
 OR (table_name='bookings' AND column_name='returned_to_preorder_at')
 OR (table_name='pre_bookings' AND column_name IN ('parent_pre_booking_id','returned_from_booking_id')));
SELECT to_regprocedure('public.protect_pre_booking_lineage()') AS must_be_null,
       to_regprocedure('public.reject_deleted_note_insert()') AS must_be_null_note_insert_guard,
       to_regclass('public.pre_bookings_converted_booking_unique') AS must_be_null_conversion_index,
       to_regclass('public.pre_bookings_returned_from_booking_unique') AS must_be_null_return_index;
SELECT conrelid::regclass AS relation,conname AS unexpected_0015_constraint
FROM pg_constraint WHERE conname IN
 ('booking_notes_deletion_pair_check','pre_bookings_converted_booking_fk',
  'pre_bookings_parent_fk','pre_bookings_returned_booking_fk',
  'pre_bookings_parent_return_pair_check','pre_bookings_parent_earlier_check',
  'bookings_returned_inactive_check');
SELECT tgrelid::regclass AS relation,tgname AS unexpected_0015_trigger
FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
 ('booking_notes_insert_guard','pre_bookings_lineage_guard');

-- Existing 0014 protections and runtime grants/policies must be reviewed.
SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition,
       t.tgfoid=to_regprocedure('public.reject_booking_note_mutation()') AS note_guard_function
FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.booking_notes') AND NOT t.tgisinternal
ORDER BY t.tgname;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN ('booking_notes','audit_logs')
ORDER BY tablename,policyname;
SELECT r.rolname,has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'SELECT') AS notes_select,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'INSERT') AS notes_insert,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'UPDATE') AS table_update_must_be_false,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'DELETE') AS delete_must_be_false,
       has_table_privilege(r.oid,to_regclass('public.audit_logs'),'INSERT') AS audit_insert
FROM pg_roles r WHERE r.rolname IN ('gas_app_runtime','anon','authenticated',current_user);
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('bookings','pre_bookings','booking_notes')
ORDER BY tablename,indexname;

-- Baseline. Save all five counts. Existing rows must be unchanged by 0015.
SELECT (SELECT count(*) FROM public.bookings) AS bookings_count,
       (SELECT count(*) FROM public.pre_bookings) AS pre_bookings_count,
       (SELECT count(*) FROM public.booking_notes) AS booking_notes_count,
       (SELECT count(*) FROM public.audit_logs) AS audit_logs_count,
       (SELECT count(*) FROM public.service_visits) AS service_visits_count;
-- Save these exact fingerprints and compare with verification (which removes new
-- nullable columns before hashing). Run while writes are paused.
SELECT 'bookings' AS relation,count(*) AS rows,
       md5(coalesce(string_agg(md5(to_jsonb(b)::text),'' ORDER BY id),'')) AS original_row_checksum
FROM public.bookings b
UNION ALL SELECT 'pre_bookings',count(*),
       md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id),'')) FROM public.pre_bookings p
UNION ALL SELECT 'booking_notes',count(*),
       md5(coalesce(string_agg(md5(to_jsonb(n)::text),'' ORDER BY id),'')) FROM public.booking_notes n
UNION ALL SELECT 'audit_logs',count(*),
       md5(coalesce(string_agg(md5(to_jsonb(a)::text),'' ORDER BY id),'')) FROM public.audit_logs a
UNION ALL SELECT 'service_visits',count(*),
       md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY id),'')) FROM public.service_visits s;
SELECT count(*) AS conversion_edges,
       md5(coalesce(string_agg(id::text||':'||converted_booking_id::text,',' ORDER BY id),'')) AS conversion_edges_checksum
FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL;
SELECT count(*) AS note_owner_edges,
       md5(coalesce(string_agg(id::text||':'||coalesce('B'||booking_id::text,'P'||pre_booking_id::text),',' ORDER BY id),'')) AS note_owner_edges_checksum
FROM public.booking_notes;

-- ALL anomaly counts must be zero before adding foreign keys and uniqueness.
SELECT count(*) AS dangling_converted_booking_ids_must_be_zero FROM public.pre_bookings p
WHERE p.converted_booking_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id);
SELECT count(*) AS duplicate_converted_booking_ids_must_be_zero FROM
 (SELECT converted_booking_id FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
  GROUP BY converted_booking_id HAVING count(*)>1) duplicates;
SELECT count(*) AS invalid_booking_statuses_must_be_zero FROM public.bookings
WHERE status NOT IN
 ('Хүлээгдэж буй','Баталгаажсан','Суурилуулж байна','Дууссан','Цуцлагдсан','cancelled');
SELECT count(*) AS converted_status_without_link_review FROM public.pre_bookings
WHERE status IN ('converted','Үндсэн захиалга болсон') AND converted_booking_id IS NULL;
-- Current conversion API blocks only status='converted' with a non-null link.
-- Every other linked status could try to overwrite history and is a cutover blocker.
SELECT count(*) AS linked_preorders_convertible_by_old_app_must_be_zero FROM public.pre_bookings
WHERE converted_booking_id IS NOT NULL AND status <> 'converted';
SELECT count(*) AS invalid_note_owners_must_be_zero FROM public.booking_notes
WHERE num_nonnulls(booking_id,pre_booking_id)<>1;
SELECT count(*) AS orphaned_note_owners_must_be_zero FROM public.booking_notes n
WHERE (n.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id))
   OR (n.pre_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id));
SELECT count(*) AS orphaned_service_visits_review FROM public.service_visits s
WHERE s.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=s.booking_id);

-- Single explicit data gate. FAIL means do not run 0015. Catalog/role results
-- above still require manual review, especially audit_logs INSERT under RLS.
WITH blockers AS (
 SELECT
  (SELECT count(*) FROM public.pre_bookings p WHERE p.converted_booking_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id)) AS dangling_links,
  (SELECT count(*) FROM (SELECT converted_booking_id FROM public.pre_bookings
    WHERE converted_booking_id IS NOT NULL GROUP BY converted_booking_id HAVING count(*)>1) d) AS duplicate_links,
  (SELECT count(*) FROM public.bookings WHERE status NOT IN
    ('Хүлээгдэж буй','Баталгаажсан','Суурилуулж байна','Дууссан','Цуцлагдсан','cancelled')) AS invalid_statuses,
  (SELECT count(*) FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
    AND status <> 'converted') AS old_app_reconversion_paths,
  (SELECT count(*) FROM public.booking_notes WHERE num_nonnulls(booking_id,pre_booking_id)<>1) AS invalid_note_owners,
  (SELECT count(*) FROM public.booking_notes n WHERE
    (n.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id))
    OR (n.pre_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id))) AS orphan_notes
)
SELECT *,CASE WHEN dangling_links+duplicate_links+invalid_statuses+old_app_reconversion_paths+invalid_note_owners+orphan_notes=0
  THEN 'PASS' ELSE 'FAIL - DO NOT RUN 0015' END AS data_gate FROM blockers;

-- Operational review only: these do not block the additive migration, but help
-- identify existing records that a later return API must reject.
SELECT count(*) AS zero_payment_bookings FROM public.bookings
WHERE advance=0 AND final_paid=0;
SELECT count(*) AS nonzero_or_negative_payment_bookings FROM public.bookings
WHERE advance<>0 OR final_paid<>0;
SELECT count(*) AS zero_payment_but_receipt_present_review FROM public.bookings
WHERE advance=0 AND final_paid=0 AND length(btrim(receipt))>0;
COMMIT;
