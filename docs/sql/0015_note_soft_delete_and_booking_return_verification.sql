-- READ ONLY. Run after a reviewed/manual 0015, before resuming writes or deploying
-- dependent application code. Compare counts/checksums with saved 0015 preflight.
-- Any mismatch or false gate: STOP; do not rerun 0015 or drop existing objects.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT current_database(),current_user,session_user,current_setting('search_path') AS search_path;
WITH expected(tbl,col,typ,nullable) AS (VALUES
 ('booking_notes','deleted_at','timestamp with time zone',true),
 ('booking_notes','deleted_by','jsonb',true),
 ('bookings','returned_to_preorder_at','timestamp with time zone',true),
 ('pre_bookings','parent_pre_booking_id','integer',true),
 ('pre_bookings','returned_from_booking_id','integer',true))
SELECT e.*,coalesce(format_type(a.atttypid,a.atttypmod)=e.typ AND a.attnotnull=NOT e.nullable,false) AS pass,
       pg_get_expr(d.adbin,d.adrelid) AS default_expression_must_be_null
FROM expected e LEFT JOIN pg_attribute a
 ON a.attrelid=to_regclass('public.'||e.tbl) AND a.attname=e.col AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
ORDER BY e.tbl,e.col;

-- Check the exact new constraints, foreign-key targets and index definitions.
WITH expected(name,rel) AS (VALUES
 ('booking_notes_deletion_pair_check','public.booking_notes'),
 ('pre_bookings_converted_booking_fk','public.pre_bookings'),
 ('pre_bookings_parent_fk','public.pre_bookings'),
 ('pre_bookings_returned_booking_fk','public.pre_bookings'),
 ('pre_bookings_parent_return_pair_check','public.pre_bookings'),
 ('pre_bookings_parent_earlier_check','public.pre_bookings'),
 ('bookings_returned_inactive_check','public.bookings'))
SELECT e.name,c.oid IS NOT NULL AND c.convalidated AS present_and_validated,
       pg_get_constraintdef(c.oid) AS definition
FROM expected e LEFT JOIN pg_constraint c ON c.conrelid=to_regclass(e.rel) AND c.conname=e.name
ORDER BY e.rel,e.name;
SELECT conname,
       convalidated AND confdeltype='r' AS validated_and_on_delete_restrict,
       confrelid::regclass AS referenced_table
FROM pg_constraint WHERE conrelid=to_regclass('public.pre_bookings')
 AND conname IN ('pre_bookings_converted_booking_fk','pre_bookings_parent_fk',
                 'pre_bookings_returned_booking_fk') ORDER BY conname;
WITH expected(name) AS (VALUES
 ('pre_bookings_converted_booking_unique'),('pre_bookings_returned_from_booking_unique'),
 ('pre_bookings_parent_idx'),('bookings_returned_to_preorder_idx'))
SELECT e.name,coalesce(i.indisvalid AND i.indisready,false) AS valid_and_ready,
       i.indisunique,pg_get_indexdef(i.indexrelid) AS definition
FROM expected e LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.'||e.name)
ORDER BY e.name;
SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t WHERE t.tgrelid IN (to_regclass('public.booking_notes'),to_regclass('public.pre_bookings'))
 AND NOT t.tgisinternal ORDER BY relation,t.tgname;
SELECT
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes')
   AND tgname='booking_notes_insert_guard' AND tgtype=7 AND tgenabled IN ('O','A')
   AND tgfoid=to_regprocedure('public.reject_deleted_note_insert()')) AS note_insert_guard,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes')
   AND tgname='booking_notes_immutable' AND tgtype=27 AND tgenabled IN ('O','A')
   AND tgfoid=to_regprocedure('public.reject_booking_note_mutation()')) AS note_update_delete_guard,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes')
   AND tgname='booking_notes_no_truncate' AND tgtype=34 AND tgenabled IN ('O','A')
   AND tgfoid=to_regprocedure('public.reject_booking_note_mutation()')) AS note_truncate_guard,
 EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.pre_bookings')
   AND tgname='pre_bookings_lineage_guard' AND tgenabled IN ('O','A')
   AND tgfoid=to_regprocedure('public.protect_pre_booking_lineage()')) AS lineage_guard;
SELECT p.oid::regprocedure,p.prosecdef AS security_definer_must_be_false,
       p.proconfig,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p WHERE p.oid IN
 (to_regprocedure('public.reject_booking_note_mutation()'),
  to_regprocedure('public.reject_deleted_note_insert()'),
  to_regprocedure('public.protect_pre_booking_lineage()'));

-- Runtime has only marker-column UPDATE, no DELETE. Application authorization
-- remains in requireRole; this catalog check does not impersonate app users.
SELECT r.rolname,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'SELECT') AS notes_select,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'INSERT') AS notes_insert,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'DELETE') AS delete_must_be_false,
       has_table_privilege(r.oid,to_regclass('public.booking_notes'),'UPDATE') AS table_update_must_be_false,
       has_column_privilege(r.oid,to_regclass('public.booking_notes'),'deleted_at','UPDATE') AS deleted_at_update,
       has_column_privilege(r.oid,to_regclass('public.booking_notes'),'deleted_by','UPDATE') AS deleted_by_update,
       has_column_privilege(r.oid,to_regclass('public.booking_notes'),'note','UPDATE') AS note_update_must_be_false,
       has_table_privilege(r.oid,to_regclass('public.audit_logs'),'INSERT') AS audit_insert
FROM pg_roles r WHERE r.rolname IN ('gas_app_runtime','anon','authenticated');
SELECT policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='booking_notes' ORDER BY policyname;
SELECT relrowsecurity AS notes_rls_must_be_true FROM pg_class
WHERE oid=to_regclass('public.booking_notes');

-- These must match the preflight values exactly, with no new records yet.
SELECT (SELECT count(*) FROM public.bookings) AS bookings_count,
       (SELECT count(*) FROM public.pre_bookings) AS pre_bookings_count,
       (SELECT count(*) FROM public.booking_notes) AS booking_notes_count,
       (SELECT count(*) FROM public.audit_logs) AS audit_logs_count,
       (SELECT count(*) FROM public.service_visits) AS service_visits_count;
SELECT 'bookings' AS relation,count(*) AS rows,
       md5(coalesce(string_agg(md5((to_jsonb(b)-'returned_to_preorder_at')::text),'' ORDER BY id),'')) AS original_row_checksum
FROM public.bookings b
UNION ALL SELECT 'pre_bookings',count(*),
       md5(coalesce(string_agg(md5((to_jsonb(p)-'parent_pre_booking_id'-'returned_from_booking_id')::text),'' ORDER BY id),''))
       FROM public.pre_bookings p
UNION ALL SELECT 'booking_notes',count(*),
       md5(coalesce(string_agg(md5((to_jsonb(n)-'deleted_at'-'deleted_by')::text),'' ORDER BY id),''))
       FROM public.booking_notes n
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

-- New columns start null. All existing conversion links and note owners survive.
SELECT (SELECT count(*) FROM public.booking_notes WHERE deleted_at IS NOT NULL OR deleted_by IS NOT NULL)
         AS marked_notes_must_be_zero,
       (SELECT count(*) FROM public.bookings WHERE returned_to_preorder_at IS NOT NULL)
         AS returned_bookings_must_be_zero,
       (SELECT count(*) FROM public.pre_bookings WHERE parent_pre_booking_id IS NOT NULL OR returned_from_booking_id IS NOT NULL)
         AS return_lineage_rows_must_be_zero;
SELECT count(*) AS dangling_conversion_links_must_be_zero FROM public.pre_bookings p
WHERE p.converted_booking_id IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id);
SELECT count(*) AS duplicate_conversion_links_must_be_zero FROM
 (SELECT converted_booking_id FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
  GROUP BY converted_booking_id HAVING count(*)>1) duplicates;
SELECT count(*) AS orphaned_note_owners_must_be_zero FROM public.booking_notes n
WHERE (n.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id))
   OR (n.pre_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id));
SELECT count(*) AS inherited_preorder_notes_still_linked_to_bookings FROM public.booking_notes n
JOIN public.pre_bookings p ON p.id=n.pre_booking_id
JOIN public.bookings b ON b.id=p.converted_booking_id;
COMMIT;
