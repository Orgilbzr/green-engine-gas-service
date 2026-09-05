BEGIN;

CREATE OR REPLACE FUNCTION validate_booking_manufacture_year()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  max_year integer;
BEGIN
  max_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1;

  IF NEW.manufacture_year IS NULL THEN
    RAISE EXCEPTION 'manufacture_year_required';
  END IF;

  IF NEW.manufacture_year < 1950 OR NEW.manufacture_year > max_year THEN
    RAISE EXCEPTION 'manufacture_year_invalid';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_pre_booking_manufacture_year()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  max_year integer;
BEGIN
  max_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1;

  IF NEW.manufacture_year IS NULL THEN
    RAISE EXCEPTION 'manufacture_year_required';
  END IF;

  IF NEW.manufacture_year < 1950 OR NEW.manufacture_year > max_year THEN
    RAISE EXCEPTION 'manufacture_year_invalid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_validate_manufacture_year_insert ON "bookings";
CREATE TRIGGER bookings_validate_manufacture_year_insert
BEFORE INSERT ON "bookings"
FOR EACH ROW
EXECUTE FUNCTION validate_booking_manufacture_year();

DROP TRIGGER IF EXISTS pre_bookings_validate_manufacture_year_insert ON "pre_bookings";
CREATE TRIGGER pre_bookings_validate_manufacture_year_insert
BEFORE INSERT ON "pre_bookings"
FOR EACH ROW
EXECUTE FUNCTION validate_pre_booking_manufacture_year();

COMMIT;
