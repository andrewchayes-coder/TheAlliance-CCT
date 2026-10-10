ALTER TYPE "public"."notification_status" ADD VALUE 'suppressed';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_test_account" boolean DEFAULT false NOT NULL;