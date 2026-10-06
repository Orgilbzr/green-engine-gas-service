-- Read-only investigation. Do not repair historical amounts from inferred payments.
-- Run against the confirmed production database with an authorized read-only role.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

-- Schema/other potential monetary storage: names and types only.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name IN ('bookings', 'pre_bookings')
       OR column_name ~ '(advance|prepay|deposit|payment)')
ORDER BY table_name, ordinal_position;

-- Detect custom triggers that could alter a correctly submitted advance.
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definition,
       pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t
WHERE t.tgrelid = 'public.bookings'::regclass AND NOT t.tgisinternal;

-- Screenshot reference. No customer name, phone or plate is disclosed.
SELECT id, booking_no, total_price, advance, final_paid,
       GREATEST(0, total_price::bigint - advance - final_paid) AS raw_remaining,
       status, created_at
FROM public.bookings WHERE booking_no = 'GE-261005-000066';

-- All rows, grouped by day. Match the actual report date/filter before comparing KPIs.
SELECT booking_date, COUNT(*) AS bookings,
       COUNT(*) FILTER (WHERE advance > 0) AS positive_advances,
       SUM(advance::bigint) AS advance_sum,
       SUM(final_paid::bigint) AS subsequent_payment_sum
FROM public.bookings GROUP BY booking_date ORDER BY booking_date DESC;

-- Zero rows with any explicitly recorded original advance evidence.
-- Payment deltas/final_paid cannot prove the original advance.
SELECT b.id, b.booking_no, b.advance AS current_advance,
       a.id AS audit_id, a.action, a.created_at,
       a.details->'advance' AS recorded_advance,
       a.details->'changes'->'advance' AS nested_advance_change,
       a.details->'finalPaid' AS subsequent_payment_change,
       a.details->'paymentAmount' AS subsequent_payment_delta
FROM public.bookings b
LEFT JOIN public.audit_logs a
  ON a.entity_type = 'booking' AND a.entity_id = b.id
WHERE b.advance = 0
  AND (a.details ? 'advance' OR (a.details->'changes') ? 'advance')
ORDER BY b.id, a.created_at, a.id;

-- Reference row: audit availability, lineage and evidence presence, without PII.
SELECT a.id, a.action, a.created_at, a.details ? 'advance' AS has_original_advance,
       a.details ? 'paymentAmount' AS has_payment_delta,
       a.details ? 'finalPaid' AS has_final_paid_change
FROM public.audit_logs a
WHERE a.entity_ref = 'GE-261005-000066'
ORDER BY a.created_at, a.id;
SELECT b.booking_no, p.id AS preorder_id, p.source, p.status,
       NULLIF(b.receipt, '') IS NOT NULL AS has_receipt,
       NULLIF(b.advance_note, '') IS NOT NULL AS has_advance_note,
       EXISTS (SELECT 1 FROM public.booking_notes n WHERE n.booking_id = b.id)
         AS has_booking_note
FROM public.bookings b
LEFT JOIN public.pre_bookings p ON p.converted_booking_id = b.id
WHERE b.booking_no = 'GE-261005-000066';
ROLLBACK;
