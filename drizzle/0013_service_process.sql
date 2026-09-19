BEGIN;
ALTER TABLE bookings ADD COLUMN programming_completed boolean NOT NULL DEFAULT false, ADD COLUMN programming_completed_at timestamptz, ADD COLUMN programming_completed_by jsonb;
ALTER TABLE bookings ADD COLUMN installation_completed boolean NOT NULL DEFAULT false, ADD COLUMN installation_completed_at timestamptz, ADD COLUMN installation_completed_by jsonb;
ALTER TABLE bookings ADD COLUMN handover_completed boolean NOT NULL DEFAULT false, ADD COLUMN handover_completed_at timestamptz, ADD COLUMN handover_completed_by jsonb;
CREATE TABLE service_visits (
 id serial PRIMARY KEY,
 booking_id integer REFERENCES bookings(id) ON DELETE SET NULL,
 booking_no text NOT NULL,
 visited_at timestamptz NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('programming','installation','inspection','other')),
 branch text NOT NULL,
 note text NOT NULL DEFAULT '',
 recorded_by jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_visits_booking_idx ON service_visits(booking_id);
ALTER TABLE service_visits ENABLE ROW LEVEL SECURITY;
-- Match the documented restricted runtime role if its cutover has happened.
-- No role is created and no existing table privileges/policies are changed.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gas_app_runtime') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON service_visits TO gas_app_runtime;
  GRANT USAGE ON SEQUENCE service_visits_id_seq TO gas_app_runtime;
  CREATE POLICY gas_app_runtime_service_visits ON service_visits
    FOR ALL TO gas_app_runtime USING (true) WITH CHECK (true);
 END IF;
END $$;
COMMIT;
