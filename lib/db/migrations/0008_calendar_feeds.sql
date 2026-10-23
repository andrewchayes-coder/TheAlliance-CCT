-- Additive record only. Replit Publish manages the production schema.
CREATE TABLE IF NOT EXISTS "calendar_feeds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "volunteer_profile_id" uuid NOT NULL UNIQUE REFERENCES "volunteer_profiles"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "token_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rotated_at" timestamp with time zone,
  "last_fetched_at" timestamp with time zone,
  "last_client" text,
  CONSTRAINT "calendar_feeds_last_client_check" CHECK ("last_client" IN ('google', 'microsoft', 'apple', 'other'))
);
