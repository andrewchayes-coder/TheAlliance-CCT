-- Additive reference SQL only. Production schema is applied by Replit Publish.
-- Do not run this from application startup or a deployment build hook.
ALTER TABLE "users" ADD COLUMN "profile_photo_key" text;
ALTER TABLE "auth_tokens" ADD COLUMN "pending_email" text;
