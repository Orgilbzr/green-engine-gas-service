-- FINAL MANUAL MIGRATION. Agent must NOT execute this on production.
-- Run the complete file once in Supabase SQL Editor as the existing table owner.
-- First run docs/sql/0014_booking_notes_preflight.sql and review all gates.
-- If ANY 0014 object exists, STOP: inspect verification SQL; do not rerun/drop it.
-- Pause application writes (including public preorder intake) BEFORE this transaction
-- and keep them paused until the new application is deployed and verified. Old code
-- writes pre_bookings.note; writes in the migration/deploy gap would miss this import.
-- On an error: ROLLBACK in the same session, inspect the cause/catalog, do not blindly retry.
-- No 0013 execution, existing-row UPDATE/DELETE, role creation, or existing-table ACL changes.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

-- Fail closed instead of silently skipping a previous/partial installation.
DO $$ BEGIN
 IF to_regclass('public.booking_notes') IS NOT NULL
    OR to_regclass('public.booking_notes_id_seq') IS NOT NULL
    OR to_regclass('public.pre_bookings_converted_booking_idx') IS NOT NULL
    OR to_regprocedure('public.reject_booking_note_mutation()') IS NOT NULL THEN
  RAISE EXCEPTION '0014 object already exists: inspect preflight/verification; do not rerun';
 END IF;
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.bookings'::regclass))
    OR current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.pre_bookings'::regclass)) THEN
  RAISE EXCEPTION 'Run as the existing bookings/pre_bookings owner, not the application runtime role';
 END IF;
END $$;

-- Stabilizes backfill and prevents concurrent preorder writes during the transaction.
-- This does not replace the external write pause across migration + deployment.
LOCK TABLE public.pre_bookings IN SHARE MODE;

CREATE TABLE public.booking_notes (
 id serial PRIMARY KEY,
 booking_id integer REFERENCES public.bookings(id) ON DELETE RESTRICT,
 pre_booking_id integer REFERENCES public.pre_bookings(id) ON DELETE RESTRICT,
 note text NOT NULL CONSTRAINT booking_notes_text_check CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by jsonb NOT NULL,
 legacy boolean NOT NULL DEFAULT false,
 CONSTRAINT booking_notes_owner_check CHECK (num_nonnulls(booking_id, pre_booking_id) = 1)
);
CREATE INDEX booking_notes_booking_idx ON public.booking_notes(booking_id, created_at DESC, id DESC);
CREATE INDEX booking_notes_prebooking_idx ON public.booking_notes(pre_booking_id, created_at DESC, id DESC);
CREATE INDEX pre_bookings_converted_booking_idx ON public.pre_bookings(converted_booking_id);

-- Original author/time are unknown: created_at is import time, UI labels legacy notes.
-- Exact original text is copied; existing pre_bookings.note remains intact.
-- Invalid/oversized legacy text aborts the WHOLE transaction, never truncates text.
INSERT INTO public.booking_notes(pre_booking_id, note, created_by, legacy)
 SELECT id, note, '{"id":null,"name":"Өмнөх тэмдэглэл · зохиогч тодорхойгүй","role":"legacy"}'::jsonb, true
 FROM public.pre_bookings WHERE length(btrim(note)) > 0;

CREATE FUNCTION public.reject_booking_note_mutation() RETURNS trigger
 LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Note history is append-only'; END $$;
CREATE TRIGGER booking_notes_immutable BEFORE UPDATE OR DELETE ON public.booking_notes
 FOR EACH ROW EXECUTE FUNCTION public.reject_booking_note_mutation();
CREATE TRIGGER booking_notes_no_truncate BEFORE TRUNCATE ON public.booking_notes
 FOR EACH STATEMENT EXECUTE FUNCTION public.reject_booking_note_mutation();
ALTER TABLE public.booking_notes ENABLE ROW LEVEL SECURITY;

-- Remove potentially inherited default ACLs on these NEW objects only.
REVOKE ALL ON TABLE public.booking_notes FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.booking_notes_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_booking_note_mutation() FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'gas_app_runtime'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON TABLE public.booking_notes FROM %I', role_name);
   EXECUTE format('REVOKE ALL ON SEQUENCE public.booking_notes_id_seq FROM %I', role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION public.reject_booking_note_mutation() FROM %I', role_name);
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gas_app_runtime') THEN
  -- Mirrors server-side application authorization, not JWT/tenant policies.
  GRANT SELECT, INSERT ON public.booking_notes TO gas_app_runtime;
  GRANT USAGE ON SEQUENCE public.booking_notes_id_seq TO gas_app_runtime;
  CREATE POLICY booking_notes_read ON public.booking_notes FOR SELECT TO gas_app_runtime USING (true);
  CREATE POLICY booking_notes_insert ON public.booking_notes FOR INSERT TO gas_app_runtime WITH CHECK (true);
  IF has_table_privilege('gas_app_runtime', 'public.booking_notes', 'UPDATE')
     OR has_table_privilege('gas_app_runtime', 'public.booking_notes', 'DELETE')
     OR has_table_privilege('gas_app_runtime', 'public.booking_notes', 'TRUNCATE')
     OR has_table_privilege('gas_app_runtime', 'public.booking_notes', 'TRIGGER')
     OR has_table_privilege('gas_app_runtime', 'public.booking_notes', 'REFERENCES')
     OR has_sequence_privilege('gas_app_runtime', 'public.booking_notes_id_seq', 'UPDATE') THEN
   RAISE EXCEPTION 'Runtime has excessive inherited/elevated rights: inspect role architecture first';
  END IF;
 END IF;
END $$;
COMMIT;
-- Keep the additive schema on rollback of application code; never delete note history.
