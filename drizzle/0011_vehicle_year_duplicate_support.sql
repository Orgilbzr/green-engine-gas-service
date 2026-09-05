BEGIN;

ALTER TABLE "bookings"
ADD COLUMN "manufacture_year" smallint;

ALTER TABLE "pre_bookings"
ADD COLUMN "manufacture_year" smallint;

DROP INDEX IF EXISTS "booking_plate_slot_unique";

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "bookings"
		WHERE "status" NOT IN ('Цуцлагдсан', 'cancelled')
		GROUP BY upper(regexp_replace(btrim("plate"), '[[:space:]]+', '', 'g')), "booking_date", "booking_time"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot create normalized booking plate index: active duplicate plates already exist.';
	END IF;
END
$$;

CREATE UNIQUE INDEX "booking_plate_slot_unique"
ON "bookings" (
	(upper(regexp_replace(btrim("plate"), '[[:space:]]+', '', 'g'))),
	"booking_date",
	"booking_time"
)
WHERE "status" NOT IN ('Цуцлагдсан', 'cancelled');

COMMIT;
