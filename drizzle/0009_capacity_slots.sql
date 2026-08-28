ALTER TABLE "bookings"
ADD COLUMN "capacity_slot" smallint;

ALTER TABLE "bookings"
ADD CONSTRAINT "booking_capacity_slot_check"
CHECK ("capacity_slot" IS NULL OR "capacity_slot" BETWEEN 1 AND 3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "bookings"
    WHERE "status" <> 'Цуцлагдсан'
    GROUP BY "branch", "booking_date"
    HAVING COUNT(*) > 3
  ) THEN
    RAISE EXCEPTION 'Cannot backfill capacity_slot: a branch/date has more than 3 active bookings';
  END IF;
END $$;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "branch", "booking_date"
    ORDER BY "id"
  )::smallint AS slot
  FROM "bookings"
  WHERE "status" <> 'Цуцлагдсан'
)
UPDATE "bookings" AS b
SET "capacity_slot" = ranked.slot
FROM ranked
WHERE b."id" = ranked."id";

CREATE UNIQUE INDEX "booking_branch_day_capacity_slot_unique"
ON "bookings" ("branch", "booking_date", "capacity_slot")
WHERE "capacity_slot" IS NOT NULL
  AND "status" <> 'Цуцлагдсан';
