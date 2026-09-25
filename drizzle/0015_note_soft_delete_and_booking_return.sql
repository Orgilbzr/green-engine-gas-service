-- PREPARED ONLY. Do not run without review, a successful 0015 preflight, and a write pause.
-- Run once as the existing table owner. Keep application writes paused through deployment
-- of the matching API/query changes; old code does not understand soft deletion or returns.
-- In particular, the converted_booking_id FK below makes the old booking DELETE API
-- fail for linked bookings with no note history. Do not resume old-app writes after 0015.
-- All existing rows remain in place. A failed statement rolls back this whole transaction.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;

DO $$ BEGIN
  IF to_regclass('public.bookings') IS NULL OR to_regclass('public.pre_bookings') IS NULL
     OR to_regclass('public.booking_notes') IS NULL OR to_regclass('public.audit_logs') IS NULL
     OR to_regprocedure('public.reject_booking_note_mutation()') IS NULL THEN
    RAISE EXCEPTION '0014/source schema is incomplete';
  END IF;
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.bookings'::regclass))
     OR current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.pre_bookings'::regclass))
     OR current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.booking_notes'::regclass)) THEN
    RAISE EXCEPTION 'Run 0015 as the existing table owner';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND ((table_name = 'booking_notes' AND column_name IN ('deleted_at','deleted_by'))
        OR (table_name = 'bookings' AND column_name = 'returned_to_preorder_at')
        OR (table_name = 'pre_bookings' AND column_name IN ('parent_pre_booking_id','returned_from_booking_id'))))
     OR to_regclass('public.pre_bookings_converted_booking_unique') IS NOT NULL
     OR to_regclass('public.pre_bookings_returned_from_booking_unique') IS NOT NULL
     OR to_regprocedure('public.reject_deleted_note_insert()') IS NOT NULL
     OR to_regprocedure('public.protect_pre_booking_lineage()') IS NOT NULL THEN
    RAISE EXCEPTION '0015 already exists or is partial; inspect before proceeding';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.booking_notes'::regclass
      AND tgname = 'booking_notes_immutable' AND tgenabled IN ('O','A')
      AND tgfoid = 'public.reject_booking_note_mutation()'::regprocedure)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.booking_notes'::regclass
      AND tgname = 'booking_notes_no_truncate' AND tgenabled IN ('O','A')) THEN
    RAISE EXCEPTION '0014 note mutation protections differ from expected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pre_bookings p WHERE p.converted_booking_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = p.converted_booking_id)) THEN
    RAISE EXCEPTION 'Dangling existing preorder conversion link';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pre_bookings WHERE converted_booking_id IS NOT NULL
      GROUP BY converted_booking_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Multiple preorders already point to one booking; resolve before 0015';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE status NOT IN
      ('Хүлээгдэж буй','Баталгаажсан','Суурилуулж байна','Дууссан','Цуцлагдсан','cancelled')) THEN
    RAISE EXCEPTION 'Unknown existing booking status; review before 0015';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pre_bookings
      WHERE converted_booking_id IS NOT NULL AND status <> 'converted') THEN
    RAISE EXCEPTION 'Old conversion API could overwrite a historical link; review before 0015';
  END IF;
END $$;

-- 1. Note soft deletion. Original content, author, owner and creation time are immutable.
ALTER TABLE public.booking_notes
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by jsonb;
ALTER TABLE public.booking_notes
  ADD CONSTRAINT booking_notes_deletion_pair_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- Existing INSERT permission must not allow an already-deleted note to bypass audit.
CREATE FUNCTION public.reject_deleted_note_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL THEN
    RAISE EXCEPTION 'New notes cannot start deleted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_notes_insert_guard BEFORE INSERT ON public.booking_notes
  FOR EACH ROW EXECUTE FUNCTION public.reject_deleted_note_insert();
REVOKE ALL ON FUNCTION public.reject_deleted_note_insert() FROM PUBLIC;

-- The existing trigger name/function remains in place. It still rejects DELETE and
-- TRUNCATE, and rejects every UPDATE except the first null -> nonnull deletion marker.
-- It writes the audit snapshot in the same statement/transaction as the marker.
CREATE OR REPLACE FUNCTION public.reject_booking_note_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE owner_ref text;
DECLARE linked_booking_id integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Note history cannot be physically deleted or truncated';
  END IF;
  IF OLD.deleted_at IS NOT NULL OR OLD.deleted_by IS NOT NULL
     OR NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL
     OR to_jsonb(NEW) - 'deleted_at' - 'deleted_by'
        IS DISTINCT FROM to_jsonb(OLD) - 'deleted_at' - 'deleted_by' THEN
    RAISE EXCEPTION 'Only the first note soft-delete transition is permitted';
  END IF;
  IF jsonb_typeof(NEW.deleted_by) <> 'object'
     OR coalesce(NEW.deleted_by->>'role','') NOT IN ('admin','operator')
     OR nullif(btrim(NEW.deleted_by->>'email'),'') IS NULL
     OR nullif(btrim(NEW.deleted_by->>'name'),'') IS NULL
     OR (NEW.deleted_by ? 'id' AND jsonb_typeof(NEW.deleted_by->'id') NOT IN ('number','null')) THEN
    RAISE EXCEPTION 'A valid admin/operator deletion actor snapshot is required';
  END IF;
  NEW.deleted_at := statement_timestamp();
  IF OLD.booking_id IS NOT NULL THEN
    linked_booking_id := OLD.booking_id;
    SELECT b.booking_no INTO owner_ref FROM public.bookings b WHERE b.id = OLD.booking_id;
  ELSE
    SELECT p.converted_booking_id INTO linked_booking_id
      FROM public.pre_bookings p WHERE p.id = OLD.pre_booking_id;
    owner_ref := 'PRE-' || OLD.pre_booking_id::text;
  END IF;
  INSERT INTO public.audit_logs
    (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, entity_ref, details)
  VALUES
    ((NEW.deleted_by->>'id')::integer, NEW.deleted_by->>'email', NEW.deleted_by->>'role',
     CASE WHEN OLD.booking_id IS NOT NULL THEN 'booking.note.deleted' ELSE 'preorder.note.deleted' END,
     CASE WHEN OLD.booking_id IS NOT NULL THEN 'booking' ELSE 'preorder' END,
     coalesce(OLD.booking_id, OLD.pre_booking_id), owner_ref,
     jsonb_build_object(
       'note_id', OLD.id, 'booking_id', linked_booking_id,
       'pre_booking_id', OLD.pre_booking_id, 'deleted_note', OLD.note,
       'original_author', OLD.created_by, 'original_created_at', OLD.created_at,
       'deleted_by', NEW.deleted_by, 'deleted_at', NEW.deleted_at));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reject_booking_note_mutation() FROM PUBLIC;

-- RLS and column-level grants limit the runtime to the two deletion markers.
-- The application still enforces admin/operator identity using requireRole.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gas_app_runtime') THEN
    GRANT UPDATE (deleted_at, deleted_by) ON public.booking_notes TO gas_app_runtime;
    CREATE POLICY booking_notes_soft_delete ON public.booking_notes
      FOR UPDATE TO gas_app_runtime USING (deleted_at IS NULL)
      WITH CHECK (deleted_at IS NOT NULL AND deleted_by IS NOT NULL);
  END IF;
END $$;

-- 2. Return lineage: A.converted_booking_id continues pointing to Booking A.
-- A new Preorder B points back to Booking A and optionally to source Preorder A.
ALTER TABLE public.pre_bookings
  ADD COLUMN parent_pre_booking_id integer,
  ADD COLUMN returned_from_booking_id integer;
ALTER TABLE public.pre_bookings
  ADD CONSTRAINT pre_bookings_converted_booking_fk FOREIGN KEY (converted_booking_id)
    REFERENCES public.bookings(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pre_bookings_parent_fk FOREIGN KEY (parent_pre_booking_id)
    REFERENCES public.pre_bookings(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pre_bookings_returned_booking_fk FOREIGN KEY (returned_from_booking_id)
    REFERENCES public.bookings(id) ON DELETE RESTRICT,
  ADD CONSTRAINT pre_bookings_parent_return_pair_check
    CHECK (parent_pre_booking_id IS NULL OR returned_from_booking_id IS NOT NULL),
  ADD CONSTRAINT pre_bookings_parent_earlier_check
    CHECK (parent_pre_booking_id IS NULL OR parent_pre_booking_id < id);
CREATE UNIQUE INDEX pre_bookings_converted_booking_unique
  ON public.pre_bookings(converted_booking_id) WHERE converted_booking_id IS NOT NULL;
CREATE UNIQUE INDEX pre_bookings_returned_from_booking_unique
  ON public.pre_bookings(returned_from_booking_id) WHERE returned_from_booking_id IS NOT NULL;
CREATE INDEX pre_bookings_parent_idx ON public.pre_bookings(parent_pre_booking_id)
  WHERE parent_pre_booking_id IS NOT NULL;

-- Once a preorder has been converted, its booking link cannot be overwritten or
-- cleared. Return ancestry is fixed at insertion. An A -> Booking A -> B edge must
-- agree with A's conversion; direct Booking A -> B has a null parent.
CREATE FUNCTION public.protect_pre_booking_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE parent_booking_id integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.converted_booking_id IS NOT NULL AND NEW.converted_booking_id IS DISTINCT FROM OLD.converted_booking_id)
       OR NEW.parent_pre_booking_id IS DISTINCT FROM OLD.parent_pre_booking_id
       OR NEW.returned_from_booking_id IS DISTINCT FROM OLD.returned_from_booking_id THEN
      RAISE EXCEPTION 'Existing preorder lineage cannot be changed';
    END IF;
  END IF;
  IF NEW.parent_pre_booking_id IS NOT NULL THEN
    SELECT p.converted_booking_id INTO parent_booking_id
      FROM public.pre_bookings p WHERE p.id = NEW.parent_pre_booking_id;
    IF parent_booking_id IS DISTINCT FROM NEW.returned_from_booking_id THEN
      RAISE EXCEPTION 'Preorder parent must have converted to returned booking';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pre_bookings_lineage_guard
  BEFORE INSERT OR UPDATE OF converted_booking_id, parent_pre_booking_id, returned_from_booking_id
  ON public.pre_bookings FOR EACH ROW EXECUTE FUNCTION public.protect_pre_booking_lineage();
REVOKE ALL ON FUNCTION public.protect_pre_booking_lineage() FROM PUBLIC;

-- 3. Explicit non-active return marker. Existing cancelled statuses are used because
-- both existing booking slot indexes already exempt them; a new status would require
-- replacing those indexes. The API must set status='cancelled', capacity_slot=NULL,
-- returned_to_preorder_at=now() in one transaction and exclude marked rows from
-- ordinary booking lists. The record and booking number remain permanent.
ALTER TABLE public.bookings ADD COLUMN returned_to_preorder_at timestamptz;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_returned_inactive_check
  CHECK (returned_to_preorder_at IS NULL OR
         (status IN ('cancelled','Цуцлагдсан') AND capacity_slot IS NULL
          AND advance = 0 AND final_paid = 0
          AND programming_completed = false
          AND installation_completed = false
          AND handover_completed = false));
CREATE INDEX bookings_returned_to_preorder_idx ON public.bookings(id)
  WHERE returned_to_preorder_at IS NOT NULL;

COMMIT;
