BEGIN;

-- =========================================================
-- 1. Booking number
-- =========================================================

ALTER TABLE "bookings"
ADD COLUMN "booking_no" text;

-- Existing bookings
UPDATE "bookings"
SET "booking_no" =
  'GE-' ||
  to_char(
    "created_at" AT TIME ZONE 'Asia/Ulaanbaatar',
    'YYMMDD'
  ) ||
  '-' ||
  CASE
    WHEN length("id"::text) < 6
      THEN lpad("id"::text, 6, '0')
    ELSE "id"::text
  END;

-- Automatic booking number for new bookings
CREATE OR REPLACE FUNCTION generate_booking_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.booking_no :=
    'GE-' ||
    to_char(
      COALESCE(NEW.created_at, now()) AT TIME ZONE 'Asia/Ulaanbaatar',
      'YYMMDD'
    ) ||
    '-' ||
    CASE
      WHEN length(NEW.id::text) < 6
        THEN lpad(NEW.id::text, 6, '0')
      ELSE NEW.id::text
    END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_booking_no_before_insert
BEFORE INSERT ON "bookings"
FOR EACH ROW
EXECUTE FUNCTION generate_booking_no();

ALTER TABLE "bookings"
ALTER COLUMN "booking_no" SET NOT NULL;

CREATE UNIQUE INDEX "bookings_booking_no_unique"
ON "bookings" ("booking_no");


-- =========================================================
-- 2. Audit log
-- =========================================================

CREATE TABLE "audit_logs" (
  "id" bigserial PRIMARY KEY,
  "actor_user_id" integer,
  "actor_email" text NOT NULL,
  "actor_role" text,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer,
  "entity_ref" text,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_logs_created_at_idx"
ON "audit_logs" ("created_at");

CREATE INDEX "audit_logs_actor_email_idx"
ON "audit_logs" ("actor_email");

CREATE INDEX "audit_logs_entity_idx"
ON "audit_logs" ("entity_type", "entity_id");

CREATE INDEX "audit_logs_action_idx"
ON "audit_logs" ("action");

-- Protect audit logs from Supabase Data API access.
-- The application connects directly to PostgreSQL.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

COMMIT;