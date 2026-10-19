-- Additive reference only. Replit Publish manages production schema.
-- Never run migrations from application startup.
ALTER TABLE users ADD COLUMN archived_at timestamp with time zone;
