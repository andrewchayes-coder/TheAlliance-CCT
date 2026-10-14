-- Additive record only. Replit Publish manages production schema; never run at boot.
CREATE TABLE volunteer_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_profile_id uuid NOT NULL REFERENCES volunteer_profiles(id) ON DELETE RESTRICT,
  shift_date date NOT NULL,
  source text NOT NULL,
  shift_slot_id uuid REFERENCES shift_slots(id) ON DELETE RESTRICT,
  custom_shift_id uuid REFERENCES custom_shifts(id) ON DELETE RESTRICT,
  start_time text,
  end_time text,
  hours numeric(4,2) NOT NULL,
  note text,
  entered_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT volunteer_hours_source_valid CHECK (source IN ('standing','one_time','other')),
  CONSTRAINT volunteer_hours_amount_valid CHECK (hours > 0 AND hours <= 12 AND hours * 4 = floor(hours * 4)),
  CONSTRAINT volunteer_hours_reference_valid CHECK (
    (source = 'standing' AND shift_slot_id IS NOT NULL AND custom_shift_id IS NULL) OR
    (source = 'one_time' AND custom_shift_id IS NOT NULL AND shift_slot_id IS NULL) OR
    (source = 'other' AND shift_slot_id IS NULL AND custom_shift_id IS NULL))
);
CREATE UNIQUE INDEX volunteer_hours_standing_unique ON volunteer_hours (volunteer_profile_id, shift_slot_id, shift_date) WHERE shift_slot_id IS NOT NULL;
CREATE UNIQUE INDEX volunteer_hours_one_time_unique ON volunteer_hours (volunteer_profile_id, custom_shift_id) WHERE custom_shift_id IS NOT NULL;
CREATE INDEX volunteer_hours_date_idx ON volunteer_hours (shift_date);
CREATE INDEX volunteer_hours_volunteer_idx ON volunteer_hours (volunteer_profile_id, shift_date);
