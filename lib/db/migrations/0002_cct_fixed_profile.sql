ALTER TYPE "public"."volunteer_status" ADD VALUE 'onboarding';--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ALTER COLUMN "status" SET DEFAULT 'onboarding';--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "state" text DEFAULT 'CA';--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "emergency_contact_relationship" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD COLUMN "start_date" date;