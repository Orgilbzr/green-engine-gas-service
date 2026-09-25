-- READ ONLY. One statement / one result table for Supabase SQL Editor.
-- Run only after the separately reviewed 0015 migration and while writes are paused.
-- The five counts and row checksums below are the supplied PAUSED preflight baseline.
-- This does not change the original verification SQL or run the migration.
-- The paused conversion/note-owner edge checksums were not supplied. Their rows
-- therefore remain WARNING for direct comparison, even when full row hashes pass.
WITH
baseline(relation, expected_count, expected_checksum) AS (VALUES
  ('bookings',17::bigint,'95f6f5d7ce2260966bc4a69ab080b36e'),
  ('pre_bookings',3::bigint,'0d222c3bc3648533ce68b3270f63ca45'),
  ('booking_notes',16::bigint,'06c20b0068855456191d2319728fccf3'),
  ('service_visits',16::bigint,'2f9f44fe62706e7105960f901ded4620'),
  ('audit_logs',107::bigint,'c9f77ad4f90bb753c1233048f44efd83')
),
expected_columns(tbl,col,typ) AS (VALUES
  ('booking_notes','deleted_at','timestamp with time zone'),
  ('booking_notes','deleted_by','jsonb'),
  ('bookings','returned_to_preorder_at','timestamp with time zone'),
  ('pre_bookings','parent_pre_booking_id','integer'),
  ('pre_bookings','returned_from_booking_id','integer')
),
column_review AS (
  SELECT e.tbl,e.col,e.typ,format_type(a.atttypid,a.atttypmod) AS actual_type,
    a.attnotnull,d.oid AS default_oid,
    coalesce(format_type(a.atttypid,a.atttypmod)=e.typ
      AND NOT a.attnotnull AND d.oid IS NULL,false) AS pass
  FROM expected_columns e
  LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||e.tbl)
    AND a.attname=e.col AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
),
expected_constraints(name,relation,kind,referenced) AS (VALUES
  ('booking_notes_deletion_pair_check','public.booking_notes','c',NULL::text),
  ('pre_bookings_converted_booking_fk','public.pre_bookings','f','public.bookings'),
  ('pre_bookings_parent_fk','public.pre_bookings','f','public.pre_bookings'),
  ('pre_bookings_returned_booking_fk','public.pre_bookings','f','public.bookings'),
  ('pre_bookings_parent_return_pair_check','public.pre_bookings','c',NULL::text),
  ('pre_bookings_parent_earlier_check','public.pre_bookings','c',NULL::text),
  ('bookings_returned_inactive_check','public.bookings','c',NULL::text)
),
constraint_review AS (
  SELECT e.name,e.relation,e.referenced,pg_get_constraintdef(c.oid) AS definition,
    coalesce(c.convalidated AND c.contype::text=e.kind
      AND (e.kind<>'f' OR (c.confrelid=to_regclass(e.referenced) AND c.confdeltype='r')),false) AS pass
  FROM expected_constraints e
  LEFT JOIN pg_constraint c ON c.conrelid=to_regclass(e.relation) AND c.conname=e.name
),
expected_indexes(name,relation,unique_required,predicate) AS (VALUES
  ('pre_bookings_converted_booking_unique','public.pre_bookings',true,'converted_booking_id IS NOT NULL'),
  ('pre_bookings_returned_from_booking_unique','public.pre_bookings',true,'returned_from_booking_id IS NOT NULL'),
  ('pre_bookings_parent_idx','public.pre_bookings',false,'parent_pre_booking_id IS NOT NULL'),
  ('bookings_returned_to_preorder_idx','public.bookings',false,'returned_to_preorder_at IS NOT NULL')
),
index_review AS (
  SELECT e.name,e.relation,e.unique_required,
    pg_get_indexdef(i.indexrelid) AS definition,
    coalesce(i.indisvalid AND i.indisready AND i.indisunique=e.unique_required
      AND i.indrelid=to_regclass(e.relation)
      AND position(lower(e.predicate) in lower(pg_get_expr(i.indpred,i.indrelid)))>0,false) AS pass
  FROM expected_indexes e
  LEFT JOIN pg_index i ON i.indexrelid=to_regclass('public.'||e.name)
),
expected_triggers(name,relation,function_name,trigger_type) AS (VALUES
  ('booking_notes_insert_guard','public.booking_notes','public.reject_deleted_note_insert()',7),
  ('booking_notes_immutable','public.booking_notes','public.reject_booking_note_mutation()',27),
  ('booking_notes_no_truncate','public.booking_notes','public.reject_booking_note_mutation()',34),
  ('pre_bookings_lineage_guard','public.pre_bookings','public.protect_pre_booking_lineage()',23)
),
trigger_review AS (
  SELECT e.name,e.relation,pg_get_triggerdef(t.oid) AS definition,
    coalesce(NOT t.tgisinternal AND t.tgenabled IN ('O','A')
      AND t.tgtype=e.trigger_type AND t.tgfoid=to_regprocedure(e.function_name),false) AS pass
  FROM expected_triggers e
  LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass(e.relation) AND t.tgname=e.name
),
expected_functions(name,required_config) AS (VALUES
  ('public.reject_booking_note_mutation()','search_path=pg_catalog, public'),
  ('public.reject_deleted_note_insert()','search_path=pg_catalog'),
  ('public.protect_pre_booking_lineage()','search_path=pg_catalog, public')
),
function_review AS (
  SELECT e.name,p.proconfig,pg_get_functiondef(p.oid) AS definition,
    coalesce(NOT p.prosecdef AND p.prorettype='trigger'::regtype
      AND e.required_config=ANY(p.proconfig),false) AS pass
  FROM expected_functions e
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.name)
),
runtime_role AS (
  SELECT oid,rolname,rolbypassrls FROM pg_roles WHERE rolname='gas_app_runtime'
),
runtime_access AS (
  SELECT r.oid IS NOT NULL AS role_exists,
    CASE WHEN r.oid IS NULL THEN false ELSE has_schema_privilege(r.oid,'public','USAGE') END AS schema_usage,
    CASE WHEN r.oid IS NULL THEN false ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'SELECT') END AS notes_select,
    CASE WHEN r.oid IS NULL THEN false ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'INSERT') END AS notes_insert,
    CASE WHEN r.oid IS NULL THEN false ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'UPDATE') END AS notes_table_update,
    CASE WHEN r.oid IS NULL THEN false ELSE has_table_privilege(r.oid,to_regclass('public.booking_notes'),'DELETE') END AS notes_delete,
    CASE WHEN r.oid IS NULL THEN false ELSE has_table_privilege(r.oid,to_regclass('public.audit_logs'),'INSERT') END AS audit_insert,
    CASE WHEN r.oid IS NULL THEN false ELSE has_sequence_privilege(r.oid,to_regclass('public.booking_notes_id_seq'),'USAGE') END AS notes_sequence,
    CASE WHEN r.oid IS NULL THEN false ELSE has_sequence_privilege(r.oid,to_regclass('public.audit_logs_id_seq'),'USAGE') END AS audit_sequence,
    CASE WHEN r.oid IS NULL OR da.attnum IS NULL THEN false
      ELSE has_column_privilege(r.oid,to_regclass('public.booking_notes'),da.attnum,'UPDATE') END AS deleted_at_update,
    CASE WHEN r.oid IS NULL OR db.attnum IS NULL THEN false
      ELSE has_column_privilege(r.oid,to_regclass('public.booking_notes'),db.attnum,'UPDATE') END AS deleted_by_update,
    CASE WHEN r.oid IS NULL OR nt.attnum IS NULL THEN false
      ELSE has_column_privilege(r.oid,to_regclass('public.booking_notes'),nt.attnum,'UPDATE') END AS note_update,
    coalesce(n.relrowsecurity,false) AS notes_rls,
    coalesce(a.relrowsecurity,false) AS audit_rls,
    coalesce(r.rolbypassrls,false) OR (r.oid IS NOT NULL AND r.oid=n.relowner AND NOT n.relforcerowsecurity) AS notes_rls_bypass,
    coalesce(r.rolbypassrls,false) OR (r.oid IS NOT NULL AND r.oid=a.relowner AND NOT a.relforcerowsecurity) AS audit_rls_bypass
  FROM (SELECT 1) seed
  LEFT JOIN runtime_role r ON true
  LEFT JOIN pg_class n ON n.oid=to_regclass('public.booking_notes')
  LEFT JOIN pg_class a ON a.oid=to_regclass('public.audit_logs')
  LEFT JOIN pg_attribute da ON da.attrelid=n.oid AND da.attname='deleted_at' AND NOT da.attisdropped
  LEFT JOIN pg_attribute db ON db.attrelid=n.oid AND db.attname='deleted_by' AND NOT db.attisdropped
  LEFT JOIN pg_attribute nt ON nt.attrelid=n.oid AND nt.attname='note' AND NOT nt.attisdropped
),
runtime_policies AS (
  SELECT
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('SELECT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND qual='true') AS notes_open_read,
    count(*) FILTER (WHERE tablename='booking_notes' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND with_check='true') AS notes_open_insert,
    count(*) FILTER (WHERE tablename='audit_logs' AND cmd IN ('INSERT','ALL')
      AND ('gas_app_runtime'=ANY(roles) OR 'public'=ANY(roles)) AND with_check='true') AS audit_open_insert
  FROM pg_policies WHERE schemaname='public' AND tablename IN ('booking_notes','audit_logs')
),
soft_delete_policy AS (
  SELECT policyname,roles,cmd,qual,with_check
  FROM pg_policies WHERE schemaname='public' AND tablename='booking_notes'
    AND policyname='booking_notes_soft_delete'
),
api_roles AS (
  SELECT r.rolname,
    coalesce(has_table_privilege(r.oid,to_regclass('public.booking_notes'),'DELETE'),false) AS notes_delete,
    coalesce(has_table_privilege(r.oid,to_regclass('public.booking_notes'),'UPDATE'),false) AS notes_table_update,
    coalesce(has_column_privilege(r.oid,to_regclass('public.booking_notes'),'note','UPDATE'),false) AS note_update
  FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
),
fingerprints AS (
  -- Identical row formulas and id ordering to the original verification SQL.
  SELECT 'bookings' AS relation,count(*) AS rows,
    md5(coalesce(string_agg(md5((to_jsonb(b)-'returned_to_preorder_at')::text),'' ORDER BY id),'')) AS checksum
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
integrity AS (
  SELECT
    (SELECT count(*) FROM public.booking_notes n
      WHERE n.deleted_at IS NOT NULL OR n.deleted_by IS NOT NULL) AS marked_notes,
    (SELECT count(*) FROM public.bookings b
      WHERE (to_jsonb(b)->>'returned_to_preorder_at') IS NOT NULL) AS returned_bookings,
    (SELECT count(*) FROM public.pre_bookings p
      WHERE (to_jsonb(p)->>'parent_pre_booking_id') IS NOT NULL
         OR (to_jsonb(p)->>'returned_from_booking_id') IS NOT NULL) AS return_lineage_rows,
    (SELECT count(*) FROM public.pre_bookings p WHERE p.converted_booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=p.converted_booking_id)) AS dangling_links,
    (SELECT count(*) FROM (SELECT converted_booking_id FROM public.pre_bookings
      WHERE converted_booking_id IS NOT NULL GROUP BY converted_booking_id HAVING count(*)>1) duplicates) AS duplicate_links,
    (SELECT count(*) FROM public.booking_notes n WHERE
      (n.booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id=n.booking_id))
      OR (n.pre_booking_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.id=n.pre_booking_id))) AS orphan_notes,
    (SELECT count(*) FROM public.booking_notes
      WHERE num_nonnulls(booking_id,pre_booking_id)<>1) AS invalid_note_owners,
    (SELECT count(*) FROM public.booking_notes n JOIN public.pre_bookings p ON p.id=n.pre_booking_id
      JOIN public.bookings b ON b.id=p.converted_booking_id) AS inherited_preorder_notes
),
checks AS (
  SELECT 1 AS sort_key,'SQL_EDITOR_IDENTITY' AS check_name,current_user::text AS value,
    'WARNING' AS status,'SQL Editor identity does not prove the application runtime role; session_user='||session_user AS detail
  UNION ALL SELECT 10,'COLUMN_'||upper(tbl)||'_'||upper(col),
    coalesce(actual_type,'MISSING'),CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
    'expected='||typ||'; nullable=true; default=NULL; actual nullable='||coalesce((NOT attnotnull)::text,'MISSING')||
      '; default='||CASE WHEN default_oid IS NULL THEN 'NULL' ELSE 'PRESENT' END
  FROM column_review
  UNION ALL SELECT 20,'CONSTRAINT_'||upper(name),
    pass::text,CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
    coalesce(definition,'MISSING')||coalesce('; referenced='||referenced||'; ON DELETE RESTRICT','')
  FROM constraint_review
  UNION ALL SELECT 30,'INDEX_'||upper(name),
    pass::text,CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
    'expected unique='||unique_required::text||'; '||coalesce(definition,'MISSING')
  FROM index_review
  UNION ALL SELECT 40,'TRIGGER_'||upper(name),
    pass::text,CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,coalesce(definition,'MISSING')
  FROM trigger_review
  UNION ALL SELECT 50,'FUNCTION_'||upper(name),
    pass::text,CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
    'SECURITY DEFINER must be false; config='||coalesce(proconfig::text,'MISSING')||
      '; definition='||coalesce(definition,'MISSING')
  FROM function_review
  UNION ALL SELECT 60,'BOOKING_NOTES_RLS',r.notes_rls::text,
    CASE WHEN r.notes_rls THEN 'PASS' ELSE 'FAIL' END,'RLS must remain enabled' FROM runtime_access r
  UNION ALL SELECT 61,'GAS_APP_RUNTIME_ROLE',r.role_exists::text,
    CASE WHEN r.role_exists THEN 'PASS' ELSE 'WARNING' END,
    '0015 creates marker grants/policy only if this role exists; confirm actual app connection role separately'
  FROM runtime_access r
  UNION ALL SELECT 62,'GAS_RUNTIME_NOTE_READ_INSERT',
    ('SELECT='||r.notes_select||'; INSERT='||r.notes_insert)::text,
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.schema_usage AND r.notes_select AND r.notes_insert AND r.notes_sequence
        AND (NOT r.notes_rls OR r.notes_rls_bypass OR (p.notes_open_read>0 AND p.notes_open_insert>0)) THEN 'PASS'
      ELSE 'FAIL' END,
    'schema USAGE='||r.schema_usage||'; sequence USAGE='||r.notes_sequence||
      '; note RLS='||r.notes_rls||'; open read/insert policies='||p.notes_open_read||'/'||p.notes_open_insert
  FROM runtime_access r CROSS JOIN runtime_policies p
  UNION ALL SELECT 63,'GAS_RUNTIME_NOTE_SOFT_DELETE_RIGHTS',
    ('marker UPDATE='||r.deleted_at_update||'/'||r.deleted_by_update)::text,
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.deleted_at_update AND r.deleted_by_update AND NOT r.notes_table_update
        AND NOT r.note_update AND NOT r.notes_delete THEN 'PASS' ELSE 'FAIL' END,
    'table UPDATE='||r.notes_table_update||'; note text UPDATE='||r.note_update||'; physical DELETE='||r.notes_delete
  FROM runtime_access r
  UNION ALL SELECT 64,'GAS_RUNTIME_SOFT_DELETE_POLICY',
    coalesce(p.policyname,'MISSING'),
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN p.policyname IS NOT NULL AND p.cmd='UPDATE' AND p.roles=ARRAY['gas_app_runtime']::name[]
        AND position('deleted_at is null' in lower(coalesce(p.qual,'')))>0
        AND position('deleted_at is not null' in lower(coalesce(p.with_check,'')))>0
        AND position('deleted_by is not null' in lower(coalesce(p.with_check,'')))>0 THEN 'PASS'
      ELSE 'FAIL' END,
    'roles='||coalesce(p.roles::text,'MISSING')||'; cmd='||coalesce(p.cmd,'MISSING')||
      '; USING='||coalesce(p.qual,'MISSING')||'; WITH CHECK='||coalesce(p.with_check,'MISSING')
  FROM runtime_access r LEFT JOIN soft_delete_policy p ON true
  UNION ALL SELECT 65,'GAS_RUNTIME_AUDIT_INSERT_RLS',r.audit_insert::text,
    CASE WHEN NOT r.role_exists THEN 'WARNING'
      WHEN r.schema_usage AND r.audit_insert AND r.audit_sequence
        AND (NOT r.audit_rls OR r.audit_rls_bypass OR p.audit_open_insert>0) THEN 'PASS' ELSE 'FAIL' END,
    'audit sequence USAGE='||r.audit_sequence||'; audit RLS='||r.audit_rls||
      '; open INSERT policies='||p.audit_open_insert
  FROM runtime_access r CROSS JOIN runtime_policies p
  UNION ALL SELECT 66,'API_ROLE_NOTE_MUTATION_RIGHTS_'||upper(rolname),
    ('DELETE='||notes_delete||'; table UPDATE='||notes_table_update||'; note UPDATE='||note_update)::text,
    CASE WHEN NOT notes_delete AND NOT notes_table_update AND NOT note_update THEN 'PASS' ELSE 'FAIL' END,
    'anon/authenticated cannot physically delete or edit original note text'
  FROM api_roles
  UNION ALL SELECT 70,'ROW_COUNT_'||upper(b.relation),f.rows::text,
    CASE WHEN f.rows=b.expected_count THEN 'PASS' ELSE 'FAIL' END,
    'paused baseline='||b.expected_count FROM baseline b JOIN fingerprints f USING (relation)
  UNION ALL SELECT 71,'ROW_CHECKSUM_'||upper(b.relation),f.checksum,
    CASE WHEN f.checksum=b.expected_checksum THEN 'PASS' ELSE 'FAIL' END,
    'paused baseline='||b.expected_checksum||'; original verification formula' FROM baseline b JOIN fingerprints f USING (relation)
  UNION ALL SELECT 80,'CONVERSION_EDGE_COUNT',e.edges::text,'WARNING',
    'Original verification output; paused edge count was not supplied for direct comparison' FROM conversion_fingerprint e
  UNION ALL SELECT 81,'CONVERSION_EDGE_CHECKSUM',e.checksum,'WARNING',
    'Compare manually with paused CONVERSION_EDGE_CHECKSUM; no paused edge checksum was supplied' FROM conversion_fingerprint e
  UNION ALL SELECT 82,'NOTE_OWNER_EDGE_COUNT',e.edges::text,
    CASE WHEN e.edges=(SELECT expected_count FROM baseline WHERE relation='booking_notes') THEN 'PASS' ELSE 'FAIL' END,
    'Every existing note has one owner edge; paused note count=16' FROM note_owner_fingerprint e
  UNION ALL SELECT 83,'NOTE_OWNER_EDGE_CHECKSUM',e.checksum,'WARNING',
    'Compare manually with paused NOTE_OWNER_EDGE_CHECKSUM; no paused edge checksum was supplied' FROM note_owner_fingerprint e
  UNION ALL SELECT 90,'MARKED_NOTES_MUST_BE_ZERO',i.marked_notes::text,
    CASE WHEN i.marked_notes=0 THEN 'PASS' ELSE 'FAIL' END,'No note may be soft-deleted before the paused write window ends' FROM integrity i
  UNION ALL SELECT 91,'RETURNED_BOOKINGS_MUST_BE_ZERO',i.returned_bookings::text,
    CASE WHEN i.returned_bookings=0 THEN 'PASS' ELSE 'FAIL' END,'New booking marker begins NULL' FROM integrity i
  UNION ALL SELECT 92,'RETURN_LINEAGE_ROWS_MUST_BE_ZERO',i.return_lineage_rows::text,
    CASE WHEN i.return_lineage_rows=0 THEN 'PASS' ELSE 'FAIL' END,'New preorder ancestry columns begin NULL' FROM integrity i
  UNION ALL SELECT 93,'DANGLING_CONVERSION_LINKS',i.dangling_links::text,
    CASE WHEN i.dangling_links=0 THEN 'PASS' ELSE 'FAIL' END,'Every converted_booking_id references an existing booking' FROM integrity i
  UNION ALL SELECT 94,'DUPLICATE_CONVERSION_LINKS',i.duplicate_links::text,
    CASE WHEN i.duplicate_links=0 THEN 'PASS' ELSE 'FAIL' END,'No booking has multiple legacy conversion links' FROM integrity i
  UNION ALL SELECT 95,'ORPHANED_NOTE_OWNERS',i.orphan_notes::text,
    CASE WHEN i.orphan_notes=0 THEN 'PASS' ELSE 'FAIL' END,'All booking/preorder note owners still exist' FROM integrity i
  UNION ALL SELECT 96,'INVALID_NOTE_OWNER_PAIRS',i.invalid_note_owners::text,
    CASE WHEN i.invalid_note_owners=0 THEN 'PASS' ELSE 'FAIL' END,'Every note must have exactly one booking/preorder owner' FROM integrity i
  UNION ALL SELECT 97,'INHERITED_PREORDER_NOTES_LINKED_TO_BOOKINGS',i.inherited_preorder_notes::text,
    'WARNING','Original verification observation; compare with paused conversion/note history' FROM integrity i
)
SELECT check_name,value,status,detail FROM (
  SELECT sort_key,check_name,value,status,detail FROM checks
  UNION ALL
  SELECT 999,'MIGRATION_VERIFICATION_GATE',
    (count(*) FILTER (WHERE status='FAIL'))::text,
    CASE WHEN count(*) FILTER (WHERE status='FAIL')>0 THEN 'FAIL'
      WHEN count(*) FILTER (WHERE status='WARNING')>0 THEN 'WARNING'
      ELSE 'PASS' END,
    'FAIL checks='||coalesce(string_agg(check_name,', ' ORDER BY sort_key,check_name)
      FILTER (WHERE status='FAIL'),'none')||
      '; WARNING checks='||coalesce(string_agg(check_name,', ' ORDER BY sort_key,check_name)
      FILTER (WHERE status='WARNING'),'none')
  FROM checks
) result
ORDER BY sort_key,check_name;
