-- Additive reference migration. Production schema changes are applied by Replit Publish, NOT app startup.
CREATE TABLE IF NOT EXISTS slot_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shift_slot_id uuid NOT NULL REFERENCES shift_slots(id),
 date date NOT NULL, reason text NOT NULL,
 created_by_user_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS slot_blocks_slot_date_unique ON slot_blocks(shift_slot_id,date);
CREATE TABLE IF NOT EXISTS custom_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),date date NOT NULL,
 start_time text NOT NULL,end_time text NOT NULL,capacity integer NOT NULL DEFAULT 2,
 label text,open_to_volunteers boolean NOT NULL DEFAULT false,
 created_by_user_id uuid NOT NULL REFERENCES users(id),cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT custom_shifts_capacity_valid CHECK(capacity BETWEEN 1 AND 10),
 CONSTRAINT custom_shifts_time_valid CHECK(start_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND start_time < end_time)
);
CREATE INDEX IF NOT EXISTS custom_shifts_date_idx ON custom_shifts(date);
CREATE TABLE IF NOT EXISTS custom_shift_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 custom_shift_id uuid NOT NULL REFERENCES custom_shifts(id),
 volunteer_profile_id uuid NOT NULL REFERENCES volunteer_profiles(id),
 created_by_user_id uuid NOT NULL REFERENCES users(id),cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_shift_assignments_live_unique ON custom_shift_assignments(custom_shift_id,volunteer_profile_id) WHERE cancelled_at IS NULL;
