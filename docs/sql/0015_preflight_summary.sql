-- READ ONLY. Run this single statement in Supabase SQL Editor before 0015.
-- It shows one result table. Save every row, especially the five row checksums
-- and the conversion/note-owner edge checksums, for the later verification.
-- Counts/checksums can change while the application accepts writes; repeat under
-- the planned write pause before comparing them with post-migration verification.
-- A SQL Editor role is not proof of the application's DATABASE_URL runtime role.
WITH
expected_source(tbl, col, typ) AS (VALUES
  ('bookings','id','integer'), ('bookings','status','text'),
  ('bookings','advance','integer'), ('bookings','final_paid','integer'),
  ('bookings','programming_completed','boolean'), ('bookings','installation_completed','boolean'),
  ('bookings','handover_completed','boolean'), ('bookings','capacity_slot','smallint'),
  ('pre_bookings','id','integer'), ('pre_bookings','converted_booking_id','integer'),
  ('pre_bookings','status','text'), ('booking_notes','id','integer'),
  ('booking_notes','booking_id','integer'), ('booking_notes','pre_booking_id','integer'),
  ('booking_notes','note','text'), ('booking_notes','created_at','timestamp with time zone'),
  ('booking_notes','created_by','jsonb'), ('audit_logs','details','jsonb')
),
source_contract AS (
  SELECT count(*) FILTER (WHERE NOT coalesce(format_type(a.atttypid,a.atttypmod)=e.typ,false)) AS bad_count,
         string_agg(e.tbl||'.'||e.col||' expected '||e.typ, ', ' ORDER BY e.tbl,e.col)
           FILTER (WHERE NOT coalesce(format_type(a.atttypid,a.atttypmod)=e.typ,false)) AS bad_detail
  FROM expected_source e LEFT JOIN pg_attribute a
    ON a.attrelid=to_regclass('public.'||e.tbl) AND a.attname=e.col AND NOT a.attisdropped
),
migration_owner AS (
  SELECT count(*) FILTER (WHERE pg_get_userbyid(c.relowner) IS DISTINCT FROM current_user) AS mismatch_count,
    string_agg(v.name||' owner='||coalesce(pg_get_userbyid(c.relowner),'MISSING'), ', ' ORDER BY v.name)
      AS owners
  FROM (VALUES ('public.bookings'),('public.pre_bookings'),('public.booking_notes')) v(name)
  LEFT JOIN pg_class c ON c.oid=to_regclass(v.name)
),
partial_objects AS (
  SELECT 'column' AS kind, table_name||'.'||column_name AS name
  FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='booking_notes' AND column_name IN ('deleted_at','deleted_by'))
     OR (table_name='bookings' AND column_name='returned_to_preorder_at')
     OR (table_name='pre_bookings' AND column_name IN ('parent_pre_booking_id','returned_from_booking_id')))
  UNION ALL SELECT 'function', 'protect_pre_booking_lineage()'
    WHERE to_regprocedure('public.protect_pre_booking_lineage()') IS NOT NULL
  UNION ALL SELECT 'function', 'reject_deleted_note_insert()'
    WHERE to_regprocedure('public.reject_deleted_note_insert()') IS NOT NULL
  UNION ALL SELECT 'index', v.name FROM (VALUES
    ('pre_bookings_converted_booking_unique'), ('pre_bookings_returned_from_booking_unique'),
    ('pre_bookings_parent_idx'), ('bookings_returned_to_preorder_idx')) v(name)
    WHERE to_regclass('public.'||v.name) IS NOT NULL
  UNION ALL SELECT 'constraint', conname FROM pg_constraint WHERE conname IN
    ('booking_notes_deletion_pair_check','pre_bookings_converted_booking_fk',
     'pre_bookings_parent_fk','pre_bookings_returned_booking_fk',
     'pre_bookings_parent_return_pair_check','pre_bookings_parent_earlier_check',
     'bookings_returned_inactive_check')
  UNION ALL SELECT 'trigger', tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('booking_notes_insert_guard','pre_bookings_lineage_guard')
),
partial_summary AS (
  SELECT count(*) AS object_count, string_agg(kind||':'||name, ', ' ORDER BY kind,name) AS objects
  FROM partial_objects
),
existing_note_guard AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes')
      AND tgname='booking_notes_immutable' AND tgenabled IN ('O','A')
      AND tgfoid=to_regprocedure('public.reject_booking_note_mutation()')) AS mutation_guard,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.booking_notes')
      AND tgname='booking_notes_no_truncate' AND tgenabled IN ('O','A')) AS truncate_guard
),
runtime_role AS (
  SELECT oid, rolname, rolbypassrls FROM pg_roles WHERE rolname='gas_app_runtime'
),
runtime_access AS (
  SELECT r.oid IS NOT NULL AS role_exists,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_schema_privilege(r.oid,'public','USAGE') END AS schema_usage,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'SELECT') END AS notes_select,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'INSERT') END AS notes_insert,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_sequence_privilege(r.oid,to_regclass('public.booking_notes_id_seq'),'USAGE') END AS notes_sequence_usage,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'UPDATE') END AS notes_table_update,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'DELETE') END AS notes_delete,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_table_privilege(r.oid,to_regclass('public.audit_logs'),'INSERT') END AS audit_insert,
         CASE WHEN r.oid IS NULL THEN NULL ELSE has_sequence_privilege(r.oid,to_regclass('public.audit_logs_id_seq'),'USAGE') END AS audit_sequence_usage,
         coalesce(r.rolbypassrls,false) OR (r.oid IS NOT NULL AND r.oid=c.relowner AND NOT c.relforcerowsecurity)
           AS notes_rls_bypass,
         coalesce(r.rolbypassrls,false) OR (r.oid IS NOT NULL AND r.oid=a.relowner AND NOT a.relforcerowsecurity)
           AS audit_rls_bypass,
         coalesce(c.relrowsecurity,false) AS notes_rls,
         coalesce(a.relrowsecurity,false) AS audit_rls
  FROM (SELECT 1) seed LEFT JOIN runtime_role r ON true
  LEFT JOIN pg_class c ON c.oid=to_regclass('public.booking_notes')
  LEFT JOIN pg_class a ON a.oid=to_regclass('public.audit_logs')
),
runtime_policies AS (
  SELECT
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('SELECT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles))) AS notes_read_policies,
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('SELECT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND qual='true') AS notes_open_read_policies,
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles))) AS notes_insert_policies,
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND with_check='true') AS notes_open_insert_policies,
    count(*) FILTER (WHERE tablename='audit_logs' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles))) AS audit_insert_policies,
    count(*) FILTER (WHERE tablename='audit_logs' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND with_check='true') AS audit_open_insert_policies,
    string_agg(tablename||'.'||policyname||' ['||cmd||']', ', ' ORDER BY tablename,policyname)
      AS policy_detail
  FROM pg_policies WHERE schemaname='public' AND tablename IN ('booking_notes','audit_logs')
),
counts AS (
  SELECT (SELECT count(*) FROM public.bookings) AS bookings,
         (SELECT count(*) FROM public.pre_bookings) AS pre_bookings,
         (SELECT count(*) FROM public.booking_notes) AS booking_notes,
         (SELECT count(*) FROM public.service_visits) AS service_visits,
         (SELECT count(*) FROM public.audit_logs) AS audit_logs
),
row_fingerprints AS (
  -- Exact expressions and ordering from the approved preflight.
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
    md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY id),'')) FROM public.service_visits s
),
conversion_fingerprint AS (
  SELECT count(*) AS edges,
    md5(coalesce(string_agg(id::text||':'||converted_booking_id::text,',' ORDER BY id),'')) AS checksum
  FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
),
note_owner_fingerprint AS (
  SELECT count(*) AS edges,
    md5(coalesce(string_agg(id::text||':'||coalesce('B'||booking_id::text,'P'||pre_booking_id::text),',' ORDER BY id),'')) AS checksum
  FROM public.booking_notes
),
anomalies AS (
  SELECT
    (SELECT count(*) FROM public.pre_bookings p WHERE p.converted_booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id)) AS dangling_links,
    (SELECT count(*) FROM (SELECT converted_booking_id FROM public.pre_bookings
      WHERE converted_booking_id IS NOT NULL GROUP BY converted_booking_id HAVING count(*)>1) d) AS duplicate_links,
    (SELECT count(*) FROM public.booking_notes n WHERE n.booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id)) AS orphan_booking_notes,
    (SELECT count(*) FROM public.booking_notes n WHERE n.pre_booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id)) AS orphan_preorder_notes,
    (SELECT count(*) FROM public.booking_notes WHERE num_nonnulls(booking_id,pre_booking_id)<>1) AS invalid_note_owners,
    (SELECT count(*) FROM public.bookings WHERE status NOT IN
      ('Хүлээгдэж буй','Баталгаажсан','Суурилуулж байна','Дууссан','Цуцлагдсан','cancelled')) AS invalid_statuses,
    (SELECT count(*) FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
      AND status <> 'converted') AS old_app_reconversion_paths,
    (SELECT count(*) FROM public.pre_bookings WHERE status IN ('converted','Үндсэн захиалга болсон')
      AND converted_booking_id IS NULL) AS converted_status_without_link,
    (SELECT count(*) FROM public.service_visits s WHERE s.booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=s.booking_id)) AS orphan_service_visits,
    (SELECT count(*) FROM public.bookings WHERE advance=0 AND final_paid=0) AS zero_payment,
    (SELECT count(*) FROM public.bookings WHERE advance<>0 OR final_paid<>0) AS nonzero_payment,
    (SELECT count(*) FROM public.bookings WHERE advance=0 AND final_paid=0
      AND length(btrim(receipt))>0) AS zero_payment_receipt
),
checks AS (
  SELECT 1 AS sort_key, 'SQL_EDITOR_IDENTITY' AS check_name, current_user::text AS value, 'WARNING' AS status,
    'database='||current_database()||'; SQL Editor identity does not establish the app DATABASE_URL role' AS detail
  UNION ALL SELECT 10 AS sort_key, 'BOOKINGS_COUNT' AS check_name, c.bookings::text AS value, 'OK' AS status,
    'Existing row count; compare again under the write pause' AS detail FROM counts c
  UNION ALL SELECT 11,'PRE_BOOKINGS_COUNT',c.pre_bookings::text,'OK','Existing row count' FROM counts c
  UNION ALL SELECT 12,'BOOKING_NOTES_COUNT',c.booking_notes::text,'OK','Existing row count' FROM counts c
  UNION ALL SELECT 13,'SERVICE_VISITS_COUNT',c.service_visits::text,'OK','Existing row count' FROM counts c
  UNION ALL SELECT 14,'AUDIT_LOGS_COUNT',c.audit_logs::text,'OK','Existing row count' FROM counts c
  UNION ALL SELECT 15,'CONVERSION_LINK_COUNT',f.edges::text,'OK','Non-null converted_booking_id' FROM conversion_fingerprint f
  UNION ALL SELECT 16,'NOTE_OWNER_EDGE_COUNT',f.edges::text,'OK','Every booking_notes row, using the approved edge formula' FROM note_owner_fingerprint f
  UNION ALL SELECT 20,'ROW_CHECKSUM_'||upper(f.relation),f.original_row_checksum,'OK',f.rows::text||' rows; approved preflight formula' FROM row_fingerprints f
  UNION ALL SELECT 26,'CONVERSION_EDGE_CHECKSUM',f.checksum,'OK',f.edges::text||' links; approved preflight formula' FROM conversion_fingerprint f
  UNION ALL SELECT 27,'NOTE_OWNER_EDGE_CHECKSUM',f.checksum,'OK',f.edges::text||' notes; approved preflight formula' FROM note_owner_fingerprint f
  UNION ALL SELECT 30,'DUPLICATE_CONVERTED_BOOKING_ID',a.duplicate_links::text,
    CASE WHEN a.duplicate_links>0 THEN 'BLOCKER' ELSE 'OK' END,'Duplicate non-null key groups' FROM anomalies a
  UNION ALL SELECT 31,'DANGLING_CONVERTED_BOOKING_ID',a.dangling_links::text,
    CASE WHEN a.dangling_links>0 THEN 'BLOCKER' ELSE 'OK' END,'Converted booking FK target missing' FROM anomalies a
  UNION ALL SELECT 32,'ORPHAN_BOOKING_NOTES',a.orphan_booking_notes::text,
    CASE WHEN a.orphan_booking_notes>0 THEN 'BLOCKER' ELSE 'OK' END,'Booking note owner missing' FROM anomalies a
  UNION ALL SELECT 33,'ORPHAN_PREORDER_NOTES',a.orphan_preorder_notes::text,
    CASE WHEN a.orphan_preorder_notes>0 THEN 'BLOCKER' ELSE 'OK' END,'Preorder note owner missing' FROM anomalies a
  UNION ALL SELECT 34,'INVALID_NOTE_OWNERS',a.invalid_note_owners::text,
    CASE WHEN a.invalid_note_owners>0 THEN 'BLOCKER' ELSE 'OK' END,'Exactly one booking/preorder owner required' FROM anomalies a
  UNION ALL SELECT 35,'INVALID_BOOKING_STATUSES',a.invalid_statuses::text,
    CASE WHEN a.invalid_statuses>0 THEN 'BLOCKER' ELSE 'OK' END,'Approved booking status set' FROM anomalies a
  UNION ALL SELECT 36,'OLD_APP_RECONVERSION_RISK',a.old_app_reconversion_paths::text,
    CASE WHEN a.old_app_reconversion_paths>0 THEN 'BLOCKER' ELSE 'OK' END,'Linked preorder status other than converted' FROM anomalies a
  UNION ALL SELECT 37,'PROPOSED_FK_VIOLATIONS',a.dangling_links::text,
    CASE WHEN a.dangling_links>0 THEN 'BLOCKER' ELSE 'OK' END,'Converted link FK; new nullable return/parent links start NULL' FROM anomalies a
  UNION ALL SELECT 38,'PROPOSED_UNIQUE_VIOLATIONS',a.duplicate_links::text,
    CASE WHEN a.duplicate_links>0 THEN 'BLOCKER' ELSE 'OK' END,'Converted link unique index; new returned-from links start NULL' FROM anomalies a
  UNION ALL SELECT 39,'PROPOSED_CHECK_VIOLATIONS','0',
    CASE WHEN p.object_count>0 THEN 'BLOCKER' ELSE 'OK' END,
    'All new marker/lineage columns start NULL; if 0015 objects exist, inspect before relying on this derived zero' FROM partial_summary p
  UNION ALL SELECT 40,'PARTIAL_0015_OBJECTS',p.object_count::text,
    CASE WHEN p.object_count>0 THEN 'BLOCKER' ELSE 'OK' END,coalesce(p.objects,'No 0015 columns, functions, indexes, constraints or triggers') FROM partial_summary p
  UNION ALL SELECT 41,'SOURCE_COLUMN_TYPE_MISMATCHES',s.bad_count::text,
    CASE WHEN s.bad_count>0 THEN 'BLOCKER' ELSE 'OK' END,coalesce(s.bad_detail,'All approved source columns and types found') FROM source_contract s
  UNION ALL SELECT 41,'MIGRATION_OWNER_MISMATCHES',o.mismatch_count::text,
    CASE WHEN o.mismatch_count>0 THEN 'BLOCKER' ELSE 'OK' END,
    '0015 must run as existing table owner; '||o.owners FROM migration_owner o
  UNION ALL SELECT 42,'EXISTING_0014_NOTE_GUARDS',
    (g.mutation_guard AND g.truncate_guard)::text,
    CASE WHEN g.mutation_guard AND g.truncate_guard THEN 'OK' ELSE 'BLOCKER' END,
    'UPDATE/DELETE guard='||g.mutation_guard::text||'; TRUNCATE guard='||g.truncate_guard::text FROM existing_note_guard g
  UNION ALL SELECT 43,'NOTE_RUNTIME_SELECT',
    coalesce(r.notes_select::text,'UNKNOWN'),
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.schema_usage AND r.notes_select AND (NOT r.notes_rls OR r.notes_rls_bypass OR p.notes_open_read_policies>0) THEN 'OK'
      ELSE 'BLOCKER' END,
    'gas_app_runtime; schema USAGE='||coalesce(r.schema_usage::text,'UNKNOWN')||
    '; note RLS='||r.notes_rls::text||'; applicable SELECT/ALL policies='||p.notes_read_policies::text||
    '; unconditional read policies='||p.notes_open_read_policies::text
    FROM runtime_access r CROSS JOIN runtime_policies p
  UNION ALL SELECT 44,'NOTE_RUNTIME_INSERT',
    coalesce(r.notes_insert::text,'UNKNOWN'),
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.schema_usage AND r.notes_insert AND r.notes_sequence_usage
        AND (NOT r.notes_rls OR r.notes_rls_bypass OR p.notes_open_insert_policies>0) THEN 'OK'
      ELSE 'BLOCKER' END,
    'gas_app_runtime; sequence USAGE='||coalesce(r.notes_sequence_usage::text,'UNKNOWN')||
    '; note RLS='||r.notes_rls::text||'; applicable INSERT/ALL policies='||p.notes_insert_policies::text||
    '; unconditional insert policies='||p.notes_open_insert_policies::text
    FROM runtime_access r CROSS JOIN runtime_policies p
  UNION ALL SELECT 45,'NOTE_RUNTIME_EXCESS_TABLE_RIGHTS',
    coalesce((r.notes_table_update OR r.notes_delete)::text,'UNKNOWN'),
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.notes_table_update OR r.notes_delete THEN 'BLOCKER' ELSE 'OK' END,
    'Pre-0015 table-wide UPDATE or DELETE must remain unavailable to gas_app_runtime' FROM runtime_access r
  UNION ALL SELECT 46,'AUDIT_INSERT_RLS_READINESS',
    coalesce(r.audit_insert::text,'UNKNOWN'),
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN NOT r.schema_usage OR NOT r.audit_insert OR NOT r.audit_sequence_usage THEN 'BLOCKER'
      WHEN r.audit_rls AND NOT r.audit_rls_bypass AND p.audit_open_insert_policies=0 THEN 'BLOCKER'
      ELSE 'OK' END,
    'gas_app_runtime; sequence USAGE='||coalesce(r.audit_sequence_usage::text,'UNKNOWN')||
    '; audit RLS='||r.audit_rls::text||'; applicable INSERT/ALL policies='||p.audit_insert_policies::text||
    '; unconditional insert policies='||p.audit_open_insert_policies::text||
    '; policies='||coalesce(p.policy_detail,'none')||'; SQL Editor identity does not prove app runtime identity'
    FROM runtime_access r CROSS JOIN runtime_policies p
  UNION ALL SELECT 50,'CONVERTED_STATUS_WITHOUT_LINK',a.converted_status_without_link::text,
    CASE WHEN a.converted_status_without_link>0 THEN 'WARNING' ELSE 'OK' END,'Operational review; no new constraint rejects this alone' FROM anomalies a
  UNION ALL SELECT 51,'ORPHAN_SERVICE_VISITS',a.orphan_service_visits::text,
    CASE WHEN a.orphan_service_visits>0 THEN 'WARNING' ELSE 'OK' END,'Operational review from approved preflight' FROM anomalies a
  UNION ALL SELECT 52,'ZERO_PAYMENT_BOOKINGS',a.zero_payment::text,'OK','advance=0 AND final_paid=0' FROM anomalies a
  UNION ALL SELECT 53,'NONZERO_OR_NEGATIVE_PAYMENT_BOOKINGS',a.nonzero_payment::text,
    CASE WHEN a.nonzero_payment>0 THEN 'WARNING' ELSE 'OK' END,'advance<>0 OR final_paid<>0; cannot return these bookings' FROM anomalies a
  UNION ALL SELECT 54,'ZERO_PAYMENT_BUT_RECEIPT_PRESENT',a.zero_payment_receipt::text,
    CASE WHEN a.zero_payment_receipt>0 THEN 'WARNING' ELSE 'OK' END,'advance=0 AND final_paid=0 AND length(btrim(receipt))>0' FROM anomalies a
)
SELECT check_name,value,status,detail FROM (
  SELECT sort_key,check_name,value,status,detail FROM checks
  UNION ALL
  SELECT 999,'MIGRATION_DATA_GATE',count(*)::text,
    CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
    CASE WHEN count(*)=0 THEN 'No BLOCKER rows in this summary; review WARNING rows and runtime identity'
         ELSE string_agg(check_name, ', ' ORDER BY sort_key) END
  FROM checks WHERE status='BLOCKER'
) result
ORDER BY sort_key,check_name;
