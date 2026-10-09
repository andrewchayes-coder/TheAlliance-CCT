CREATE TYPE "public"."auth_token_type" AS ENUM('email_verify', 'password_reset', 'admin_invite');--> statement-breakpoint
CREATE TYPE "public"."background_check_status" AS ENUM('not_started', 'pending', 'cleared', 'not_cleared');--> statement-breakpoint
CREATE TYPE "public"."certification_status" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."shift_ended_reason" AS ENUM('dropped', 'changed', 'admin_removed');--> statement-breakpoint
CREATE TYPE "public"."message_audience" AS ENUM('all', 'single', 'active', 'selected');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('logged', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('verification', 'password_reset', 'welcome', 'reminder', 'message', 'admin_alert', 'invite');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('document', 'article', 'link');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'volunteer');--> statement-breakpoint
CREATE TYPE "public"."volunteer_status" AS ENUM('applicant', 'in_training', 'active', 'inactive');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_profile_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'schedule' NOT NULL,
	"daily_digest_enabled" boolean DEFAULT true NOT NULL,
	"last_digest_date" date,
	"postmark_monthly_limit" integer DEFAULT 100 NOT NULL,
	"last_monthly_alert_month" text,
	"agreement_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_email_limit_check" CHECK ("app_settings"."postmark_monthly_limit" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "closed_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"audience" "message_audience" NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_by_email" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "notification_type" NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_user_id" uuid,
	"subject" text NOT NULL,
	"related_id" text,
	"retry_payload" text,
	"status" "notification_status" DEFAULT 'logged' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb DEFAULT '{"eligible":0,"sent":0,"logged":0,"failed":0,"skipped":0,"suppressed":0}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "reminder_job_runs_source_check" CHECK ("reminder_job_runs"."source" in ('cron','admin','external','command')),
	CONSTRAINT "reminder_job_runs_status_check" CHECK ("reminder_job_runs"."status" in ('running','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "resource_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"category" text NOT NULL,
	"body" text,
	"file_key" text,
	"file_name" text,
	"file_mime_type" text,
	"url" text,
	"is_quick_link" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_content_by_type" CHECK (
    ("resources"."type" = 'article' and length(btrim("resources"."body")) > 0 and "resources"."body" is not null)
    or ("resources"."type" = 'document' and "resources"."file_key" is not null and "resources"."file_name" is not null and "resources"."file_mime_type" is not null)
    or ("resources"."type" = 'link' and "resources"."url" is not null)),
	CONSTRAINT "resources_quick_link_type" CHECK (not "resources"."is_quick_link" or "resources"."type" = 'link')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_profile_id" uuid NOT NULL,
	"shift_slot_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_by_user_id" uuid NOT NULL,
	"ended_reason" "shift_ended_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_date_order" CHECK ("shift_assignments"."end_date" is null or "shift_assignments"."end_date" >= "shift_assignments"."start_date" or "shift_assignments"."ended_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "shift_skips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_assignment_id" uuid NOT NULL,
	"skip_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"capacity" integer DEFAULT 2 NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"retire_after_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_slots_weekday_valid" CHECK ("shift_slots"."day_of_week" between 1 and 5),
	CONSTRAINT "shift_slots_capacity_positive" CHECK ("shift_slots"."capacity" between 1 and 10),
	CONSTRAINT "shift_slots_start_time_valid" CHECK ("shift_slots"."start_time" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_slots_end_time_valid" CHECK ("shift_slots"."end_time" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "shift_slots_time_order" CHECK ("shift_slots"."end_time" > "shift_slots"."start_time")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"role" "user_role" DEFAULT 'volunteer' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"google_subject" text,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email")))
);
--> statement-breakpoint
CREATE TABLE "volunteer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"county" text DEFAULT 'Placer' NOT NULL,
	"status" "volunteer_status" DEFAULT 'applicant' NOT NULL,
	"onboarding_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"availability_notes" text,
	"certification_status" "certification_status" DEFAULT 'not_started' NOT NULL,
	"certification_completed_at" date,
	"certification_expires_at" date,
	"background_check_status" "background_check_status" DEFAULT 'not_started' NOT NULL,
	"background_check_submitted_at" date,
	"background_check_cleared_at" date,
	"agreement_acknowledged_at" timestamp with time zone,
	"agreement_version" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_volunteer_profile_id_volunteer_profiles_id_fk" FOREIGN KEY ("volunteer_profile_id") REFERENCES "public"."volunteer_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_volunteer_profile_id_volunteer_profiles_id_fk" FOREIGN KEY ("volunteer_profile_id") REFERENCES "public"."volunteer_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_slot_id_shift_slots_id_fk" FOREIGN KEY ("shift_slot_id") REFERENCES "public"."shift_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_skips" ADD CONSTRAINT "shift_skips_shift_assignment_id_shift_assignments_id_fk" FOREIGN KEY ("shift_assignment_id") REFERENCES "public"."shift_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_profiles" ADD CONSTRAINT "volunteer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_profile_created_idx" ON "activity_log" USING btree ("volunteer_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_rate_limits_window_idx" ON "auth_rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_type_idx" ON "auth_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "closed_dates_date_unique" ON "closed_dates" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "message_recipients_message_user_unique" ON "message_recipients" USING btree ("message_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "message_recipients_user_read_idx" ON "message_recipients" USING btree ("recipient_user_id","read_at");--> statement-breakpoint
CREATE INDEX "messages_sent_at_idx" ON "messages" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "notification_log_sent_at_idx" ON "notification_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "notification_log_type_idx" ON "notification_log" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_reminder_unique" ON "notification_log" USING btree ("type",coalesce("recipient_user_id"::text, ''),"related_id") WHERE "notification_log"."type" = 'reminder' and "notification_log"."related_id" is not null;--> statement-breakpoint
CREATE INDEX "reminder_job_runs_started_idx" ON "reminder_job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "resources_published_sort_idx" ON "resources" USING btree ("is_published","sort_order");--> statement-breakpoint
CREATE INDEX "resources_type_category_idx" ON "resources" USING btree ("type","category");--> statement-breakpoint
CREATE INDEX "sessions_expire_idx" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "shift_assignments_slot_idx" ON "shift_assignments" USING btree ("shift_slot_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "shift_assignments_volunteer_idx" ON "shift_assignments" USING btree ("volunteer_profile_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_assignments_standing_unique" ON "shift_assignments" USING btree ("volunteer_profile_id","shift_slot_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_skips_assignment_date_unique" ON "shift_skips" USING btree ("shift_assignment_id","skip_date");--> statement-breakpoint
CREATE INDEX "shift_skips_date_idx" ON "shift_skips" USING btree ("skip_date");--> statement-breakpoint
CREATE INDEX "shift_slots_weekday_time_idx" ON "shift_slots" USING btree ("day_of_week","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_subject_unique" ON "users" USING btree ("google_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_profiles_user_unique" ON "volunteer_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "volunteer_profiles_status_county_idx" ON "volunteer_profiles" USING btree ("status","county");