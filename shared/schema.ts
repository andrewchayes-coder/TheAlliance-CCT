import { getTableColumns, sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, json, jsonb, pgEnum, pgTable,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { z } from 'zod/v4';
import { appConfig } from './appConfig';

export const userRole = pgEnum('user_role', ['admin', 'volunteer']);
export const volunteerStatus = pgEnum('volunteer_status', ['applicant', 'in_training', 'active', 'inactive']);
export const certificationStatus = pgEnum('certification_status', ['not_started', 'in_progress', 'complete']);
export const backgroundCheckStatus = pgEnum('background_check_status', ['not_started', 'pending', 'cleared', 'not_cleared']);
export const endedReason = pgEnum('shift_ended_reason', ['dropped', 'changed', 'admin_removed']);
export const messageAudience = pgEnum('message_audience', ['all', 'single', 'active', 'selected']);
export const resourceType = pgEnum('resource_type', ['document', 'article', 'link']);
export const notificationType = pgEnum('notification_type', [
  'verification', 'password_reset', 'welcome', 'reminder', 'message', 'admin_alert', 'invite',
]);
export const notificationStatus = pgEnum('notification_status', ['logged', 'sent', 'failed', 'suppressed']);
export const authTokenType = pgEnum('auth_token_type', ['email_verify', 'password_reset', 'admin_invite']);

// Fresh column builders per table. Instants use timestamptz; calendar dates stay strings.
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
const primaryKey = () => uuid('id').primaryKey().defaultRandom();

export const usersTable = pgTable('users', {
  id: primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  role: userRole('role').notNull().default('volunteer'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  isTestAccount: boolean('is_test_account').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  googleSubject: text('google_subject'),
  sessionVersion: integer('session_version').notNull().default(0),
  ...timestamps(),
}, table => [
  uniqueIndex('users_email_unique').on(table.email),
  uniqueIndex('users_google_subject_unique').on(table.googleSubject),
  check('users_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
]);

export const volunteerProfilesTable = pgTable('volunteer_profiles', {
  id: primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  county: text('county').notNull().default(appConfig.defaultCounty),
  status: volunteerStatus('status').notNull().default('applicant'),
  onboardingAnswers: jsonb('onboarding_answers').$type<Record<string, unknown>>().notNull().default({}),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  availabilityNotes: text('availability_notes'),
  certificationStatus: certificationStatus('certification_status').notNull().default('not_started'),
  certificationCompletedAt: date('certification_completed_at', { mode: 'string' }),
  certificationExpiresAt: date('certification_expires_at', { mode: 'string' }),
  backgroundCheckStatus: backgroundCheckStatus('background_check_status').notNull().default('not_started'),
  backgroundCheckSubmittedAt: date('background_check_submitted_at', { mode: 'string' }),
  backgroundCheckClearedAt: date('background_check_cleared_at', { mode: 'string' }),
  agreementAcknowledgedAt: timestamp('agreement_acknowledged_at', { withTimezone: true }),
  agreementVersion: text('agreement_version'),
  // Internal field. Volunteer-facing queries/serialization must use the safe projection below.
  adminNotes: text('admin_notes'),
  ...timestamps(),
}, table => [
  uniqueIndex('volunteer_profiles_user_unique').on(table.userId),
  index('volunteer_profiles_status_county_idx').on(table.status, table.county),
]);

export const activityLogTable = pgTable('activity_log', {
  id: primaryKey(),
  volunteerProfileId: uuid('volunteer_profile_id').notNull().references(() => volunteerProfilesTable.id, { onDelete: 'restrict' }),
  actorUserId: uuid('actor_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [index('activity_log_profile_created_idx').on(table.volunteerProfileId, table.createdAt)]);
export const insertActivityLogSchema = createInsertSchema(activityLogTable).omit({ id: true, createdAt: true });
export type ActivityLog = typeof activityLogTable.$inferSelect;

export const appSettingsTable = pgTable('app_settings', {
  id: text('id').primaryKey().default('schedule'),
  dailyDigestEnabled: boolean('daily_digest_enabled').notNull().default(true),
  lastDigestDate: date('last_digest_date', { mode: 'string' }),
  postmarkMonthlyLimit: integer('postmark_monthly_limit').notNull().default(100),
  lastMonthlyAlertMonth: text('last_monthly_alert_month'),
  agreementVersion: text('agreement_version').notNull().default('v1'),
  ...timestamps(),
}, table => [check('app_settings_email_limit_check', sql`${table.postmarkMonthlyLimit} between 1 and 1000000`)]);
/** Persisted diagnostics; separate from per-recipient delivery history. */
export const reminderJobRunsTable = pgTable('reminder_job_runs', {
  id: primaryKey(),
  source: text('source').notNull(),
  status: text('status').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  counts: jsonb('counts').$type<{
    eligible: number; sent: number; logged: number; failed: number; skipped: number; suppressed: number;
  }>().notNull().default({ eligible: 0, sent: 0, logged: 0, failed: 0, skipped: 0, suppressed: 0 }),
  error: text('error'),
}, table => [
  index('reminder_job_runs_started_idx').on(table.startedAt),
  check('reminder_job_runs_source_check', sql`${table.source} in ('cron','admin','external','command')`),
  check('reminder_job_runs_status_check', sql`${table.status} in ('running','completed','failed')`),
]);
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;

export const shiftSlotsTable = pgTable('shift_slots', {
  id: primaryKey(),
  dayOfWeek: integer('day_of_week').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  capacity: integer('capacity').notNull().default(2),
  label: text('label'),
  isActive: boolean('is_active').notNull().default(true),
  retireAfterDate: date('retire_after_date', { mode: 'string' }),
  ...timestamps(),
}, table => [
  check('shift_slots_weekday_valid', sql`${table.dayOfWeek} between 1 and 5`),
  check('shift_slots_capacity_positive', sql`${table.capacity} between 1 and 10`),
  check('shift_slots_start_time_valid', sql`${table.startTime} ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'`),
  check('shift_slots_end_time_valid', sql`${table.endTime} ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'`),
  check('shift_slots_time_order', sql`${table.endTime} > ${table.startTime}`),
  index('shift_slots_weekday_time_idx').on(table.dayOfWeek, table.startTime),
  // Deliberately no exclusion constraint: overlapping slots are allowed.
]);

export const shiftAssignmentsTable = pgTable('shift_assignments', {
  id: primaryKey(),
  volunteerProfileId: uuid('volunteer_profile_id').notNull().references(() => volunteerProfilesTable.id, { onDelete: 'restrict' }),
  shiftSlotId: uuid('shift_slot_id').notNull().references(() => shiftSlotsTable.id, { onDelete: 'restrict' }),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  endedReason: endedReason('ended_reason'),
  ...timestamps(),
}, table => [
  index('shift_assignments_slot_idx').on(table.shiftSlotId, table.startDate, table.endDate),
  index('shift_assignments_volunteer_idx').on(table.volunteerProfileId, table.startDate, table.endDate),
  uniqueIndex('shift_assignments_standing_unique').on(table.volunteerProfileId, table.shiftSlotId, table.startDate),
  // Cancelled reservations may end before their first occurrence; ordinary assignments cannot.
  check('shift_assignments_date_order', sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate} or ${table.endedReason} is not null`),
]);

export const shiftSkipsTable = pgTable('shift_skips', {
  id: primaryKey(),
  shiftAssignmentId: uuid('shift_assignment_id').notNull().references(() => shiftAssignmentsTable.id, { onDelete: 'cascade' }),
  skipDate: date('skip_date', { mode: 'string' }).notNull(),
  ...timestamps(),
}, table => [
  uniqueIndex('shift_skips_assignment_date_unique').on(table.shiftAssignmentId, table.skipDate),
  index('shift_skips_date_idx').on(table.skipDate),
]);

export const closedDatesTable = pgTable('closed_dates', {
  id: primaryKey(),
  date: date('date', { mode: 'string' }).notNull(),
  reason: text('reason').notNull(),
  ...timestamps(),
}, table => [uniqueIndex('closed_dates_date_unique').on(table.date)]);

export const messagesTable = pgTable('messages', {
  id: primaryKey(),
  senderUserId: uuid('sender_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  audience: messageAudience('audience').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sentByEmail: boolean('sent_by_email').notNull().default(false),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
}, table => [index('messages_sent_at_idx').on(table.sentAt)]);

export const messageRecipientsTable = pgTable('message_recipients', {
  id: primaryKey(),
  messageId: uuid('message_id').notNull().references(() => messagesTable.id, { onDelete: 'cascade' }),
  recipientUserId: uuid('recipient_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  readAt: timestamp('read_at', { withTimezone: true }),
  ...timestamps(),
}, table => [
  uniqueIndex('message_recipients_message_user_unique').on(table.messageId, table.recipientUserId),
  index('message_recipients_user_read_idx').on(table.recipientUserId, table.readAt),
]);

export const resourcesTable = pgTable('resources', {
  id: primaryKey(),
  type: resourceType('type').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  category: text('category').notNull(),
  body: text('body'),
  fileKey: text('file_key'),
  fileName: text('file_name'),
  fileMimeType: text('file_mime_type'),
  url: text('url'),
  isQuickLink: boolean('is_quick_link').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(false),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => usersTable.id, { onDelete: 'restrict' }),
  ...timestamps(),
}, table => [
  index('resources_published_sort_idx').on(table.isPublished, table.sortOrder),
  index('resources_type_category_idx').on(table.type, table.category),
  check('resources_content_by_type', sql`
    (${table.type} = 'article' and length(btrim(${table.body})) > 0 and ${table.body} is not null)
    or (${table.type} = 'document' and ${table.fileKey} is not null and ${table.fileName} is not null and ${table.fileMimeType} is not null)
    or (${table.type} = 'link' and ${table.url} is not null)`),
  check('resources_quick_link_type', sql`not ${table.isQuickLink} or ${table.type} = 'link'`),
]);

export const notificationLogTable = pgTable('notification_log', {
  id: primaryKey(),
  type: notificationType('type').notNull(),
  recipientEmail: text('recipient_email').notNull(),
  recipientUserId: uuid('recipient_user_id').references(() => usersTable.id, { onDelete: 'restrict' }),
  subject: text('subject').notNull(),
  relatedId: text('related_id'),
  retryPayload: text('retry_payload'),
  status: notificationStatus('status').notNull().default('logged'),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  ...timestamps(),
}, table => [
  index('notification_log_sent_at_idx').on(table.sentAt),
  index('notification_log_type_idx').on(table.type),
  // Treat an omitted user as a real key component, rather than bypassing uniqueness.
  // No relatedId means no deduplication; unkeyed reminders are allowed.
  uniqueIndex('notification_log_reminder_unique')
    .on(table.type, sql`coalesce(${table.recipientUserId}::text, '')`, table.relatedId)
    .where(sql`${table.type} = 'reminder' and ${table.relatedId} is not null`),
]);

export const authTokensTable = pgTable('auth_tokens', {
  id: primaryKey(),
  userId: uuid('user_id').notNull().references(() => usersTable.id, { onDelete: 'cascade' }),
  type: authTokenType('type').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ...timestamps(),
}, table => [
  uniqueIndex('auth_tokens_hash_unique').on(table.tokenHash),
  index('auth_tokens_user_type_idx').on(table.userId, table.type),
  index('auth_tokens_expires_at_idx').on(table.expiresAt),
]);

const generatedFields = { id: true, createdAt: true, updatedAt: true } as const;
const emailSchema = z.string().trim().toLowerCase().email();
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a valid YYYY-MM-DD calendar date');
const clockTime = z.string().regex(/^(0\d|1\d|2[0-3]):[0-5]\d$/, 'Use HH:MM in 24-hour time');

export const insertUserSchema = createInsertSchema(usersTable, {
  email: emailSchema,
  passwordHash: z.string().min(20),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
}).omit(generatedFields);
export const insertVolunteerProfileSchema = createInsertSchema(volunteerProfilesTable, {
  county: z.string().trim().min(1).optional(),
  onboardingAnswers: z.record(z.string(), z.unknown()).optional(),
  certificationCompletedAt: calendarDate.nullable().optional(),
  certificationExpiresAt: calendarDate.nullable().optional(),
  backgroundCheckSubmittedAt: calendarDate.nullable().optional(),
  backgroundCheckClearedAt: calendarDate.nullable().optional(),
}).omit(generatedFields);
export const insertShiftSlotSchema = createInsertSchema(shiftSlotsTable, {
  dayOfWeek: z.number().int().min(1).max(5),
  startTime: clockTime,
  endTime: clockTime,
  capacity: z.number().int().min(1).max(10).optional(),
  retireAfterDate: calendarDate.nullable().optional(),
}).omit(generatedFields).refine(value => value.endTime > value.startTime, {
  path: ['endTime'], message: 'The end time must be after the start time',
});
export const insertShiftAssignmentSchema = createInsertSchema(shiftAssignmentsTable, {
  startDate: calendarDate, endDate: calendarDate.nullable().optional(),
}).omit(generatedFields).refine(value => !value.endDate || value.endDate >= value.startDate || !!value.endedReason, {
  path: ['endDate'], message: 'The end date cannot be before the start date',
});
export const insertShiftSkipSchema = createInsertSchema(shiftSkipsTable, { skipDate: calendarDate }).omit(generatedFields);
export const insertClosedDateSchema = createInsertSchema(closedDatesTable, {
  date: calendarDate, reason: z.string().trim().min(1),
}).omit(generatedFields);
export const insertMessageSchema = createInsertSchema(messagesTable, {
  subject: z.string().trim().min(1), body: z.string().trim().min(1),
}).omit(generatedFields);
export const insertMessageRecipientSchema = createInsertSchema(messageRecipientsTable).omit(generatedFields);
export const insertResourceSchema = createInsertSchema(resourcesTable, {
  title: z.string().trim().min(1),
  category: z.string().trim().min(1),
  url: z.string().url().nullable().optional(),
}).omit(generatedFields).superRefine((value, context) => {
  const required = value.type === 'document' ? ['fileKey', 'fileName', 'fileMimeType'] as const
    : value.type === 'article' ? ['body'] as const : ['url'] as const;
  for (const field of required) {
    if (!value[field]?.trim()) context.addIssue({ code: 'custom', path: [field], message: `${field} is required for ${value.type} resources` });
  }
  if (value.isQuickLink && value.type !== 'link') context.addIssue({ code: 'custom', path: ['isQuickLink'], message: 'Only links can be quick links' });
});
export const insertNotificationLogSchema = createInsertSchema(notificationLogTable, {
  recipientEmail: emailSchema,
  subject: z.string().trim().min(1),
}).omit(generatedFields);
export const insertAuthTokenSchema = createInsertSchema(authTokensTable, {
  tokenHash: z.string().min(20),
}).omit(generatedFields);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type VolunteerProfile = typeof volunteerProfilesTable.$inferSelect;
export type InsertVolunteerProfile = z.infer<typeof insertVolunteerProfileSchema>;
export type ShiftSlot = typeof shiftSlotsTable.$inferSelect;
export type InsertShiftSlot = z.infer<typeof insertShiftSlotSchema>;
export type ShiftAssignment = typeof shiftAssignmentsTable.$inferSelect;
export type InsertShiftAssignment = z.infer<typeof insertShiftAssignmentSchema>;
export type ShiftSkip = typeof shiftSkipsTable.$inferSelect;
export type InsertShiftSkip = z.infer<typeof insertShiftSkipSchema>;
export type ClosedDate = typeof closedDatesTable.$inferSelect;
export type InsertClosedDate = z.infer<typeof insertClosedDateSchema>;
export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type MessageRecipient = typeof messageRecipientsTable.$inferSelect;
export type InsertMessageRecipient = z.infer<typeof insertMessageRecipientSchema>;
export type Resource = typeof resourcesTable.$inferSelect;
export type InsertResource = z.infer<typeof insertResourceSchema>;
export type NotificationLog = typeof notificationLogTable.$inferSelect;
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type AuthToken = typeof authTokensTable.$inferSelect;
export type InsertAuthToken = z.infer<typeof insertAuthTokenSchema>;

// Defense in depth for future volunteer endpoints: query only safe columns, then parse.
const profileColumns = getTableColumns(volunteerProfilesTable);
export const volunteerProfilePublicColumns = {
  id: profileColumns.id, userId: profileColumns.userId, county: profileColumns.county,
  status: profileColumns.status, onboardingAnswers: profileColumns.onboardingAnswers,
  onboardingCompletedAt: profileColumns.onboardingCompletedAt, availabilityNotes: profileColumns.availabilityNotes,
  certificationStatus: profileColumns.certificationStatus, certificationCompletedAt: profileColumns.certificationCompletedAt,
  certificationExpiresAt: profileColumns.certificationExpiresAt, backgroundCheckStatus: profileColumns.backgroundCheckStatus,
  backgroundCheckSubmittedAt: profileColumns.backgroundCheckSubmittedAt, backgroundCheckClearedAt: profileColumns.backgroundCheckClearedAt,
  agreementAcknowledgedAt: profileColumns.agreementAcknowledgedAt, agreementVersion: profileColumns.agreementVersion,
  createdAt: profileColumns.createdAt, updatedAt: profileColumns.updatedAt,
};
export const volunteerProfilePublicSchema = createSelectSchema(volunteerProfilesTable).omit({ adminNotes: true });
export const userPublicSchema = createSelectSchema(usersTable).omit({ passwordHash: true, googleSubject: true, sessionVersion: true });
export function toVolunteerProfilePublic(profile: VolunteerProfile) {
  return volunteerProfilePublicSchema.parse(profile);
}
export type VolunteerProfilePublic = z.infer<typeof volunteerProfilePublicSchema>;

// Internal authentication infrastructure, never returned by public profile APIs.
export const sessionsTable = pgTable('sessions', {
  sid: text('sid').primaryKey(),
  sess: json('sess').notNull(),
  expire: timestamp('expire', { withTimezone: true, precision: 6 }).notNull(),
}, table => [index('sessions_expire_idx').on(table.expire)]);

export const authRateLimitsTable = pgTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
}, table => [index('auth_rate_limits_window_idx').on(table.windowStart)]);
