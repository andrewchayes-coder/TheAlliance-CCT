# Alliance Volunteer Portal

A mobile-first volunteer management portal for The Alliance's Resource Coordination Program.

## Current scope

The brand foundation, database model, development seed, shared Postmark-ready email service, email/password authentication, onboarding, approvals, volunteer dashboards/profiles, roster, scheduling, coverage alerts, and messaging are implemented. Google OAuth is prepared but unavailable until its client credentials are configured. Resource publishing remains for a later step; volunteer resource reading is implemented. UI navigation samples on the style guide remain labelled previews.

The `/style-guide` route and its lazy-loaded module are development-only. The root page is a restrained portal entry, not an authentication screen.

## Product context

- Volunteers will be verified and approved by staff, then sign up for recurring two-hour phone shifts Monday–Friday.
- The pilot is 12–15 volunteers in Placer County, growing to about 60 across five counties.
- Excellent phone usability is a requirement.
- The counties in appConfig are placeholders, not a final service-area commitment.

## Run & operate

- Managed frontend workflow: `artifacts/alliance-volunteer-portal: web`
- Managed backend workflow: `artifacts/api-server: API Server`
- `pnpm run typecheck` checks all libraries and applications.
- `pnpm --filter @workspace/api-spec run codegen` regenerates API types after contract changes.
- `pnpm --filter @workspace/db run push` applies development schema changes.
- `npm run seed` (or `pnpm run seed`) adds the development fixtures. It refuses production and other explicit non-development NODE_ENV values; an unset NODE_ENV is treated as a local development invocation.
- `pnpm --filter @workspace/scripts run verify-seed` checks fixture counts, insert validation, safe profile projection, placeholder PDFs, and database constraints. Constraint probes roll back completely; never run this on production.
- `pnpm --filter @workspace/api-server run test:email` checks the email service against the development DB using mocked delivery. It refuses production, never sends real mail, and cleans up its own temporary users/logs.

## Stack and source map

- Client: React, Vite, TypeScript, Tailwind, shadcn/ui, wouter, TanStack Query in `artifacts/alliance-volunteer-portal/src/`.
- Server: Express and TypeScript in `artifacts/api-server/src/`.
- Shared configuration: `shared/appConfig.ts`, imported as `@workspace/shared/appConfig`.
- Shared date helpers: `shared/time.ts`, imported as `@workspace/shared/time`.
- Drizzle schema source: `shared/schema.ts`, including all 11 tables, enums, indexes, insert schemas, inferred types, and safe public projections.
- Seed script and fixtures: `scripts/src/seed.ts`, `scripts/src/seed-fixtures.ts`, `scripts/src/seed-support.ts`.
- Shared email service: `artifacts/api-server/src/email.ts` (the managed server equivalent of `server/email.ts`).
- Branded HTML/plain-text wrapper: `artifacts/api-server/src/email-template.ts`, re-exported by the email service.
- PostgreSQL connection and Drizzle configuration: `lib/db/`.
- API contract: `lib/api-spec/openapi.yaml`; health, authentication, safe `/me`, and development-only email check.
- Brand CSS tokens: `artifacts/alliance-volunteer-portal/src/index.css`.
- Themed shadcn controls: `artifacts/alliance-volunteer-portal/src/components/ui/`.
- Brand layouts, status badges, and empty states: `artifacts/alliance-volunteer-portal/src/components/brand-system.tsx`.

## Architecture decisions

- Development email check: `POST /api/dev/email-test`. Uses only the shared email service, fixed example.org recipient/content, and a fresh test key. Returns the ID of a confirmed `logged` notification row. Not mounted outside development and refuses to run with both live Postmark settings present. Test audit rows remain available for inspection.

- Client and server remain separate managed artifact packages rather than literal root `client/` and `server/` directories; shared files live in the requested root `shared/` directory.
  **Why:** retain Replit's managed service routing and the existing pnpm workspace conventions without duplicating app code.
- All app settings come from `shared/appConfig.ts`; do not scatter copies of product settings across screens or server code.
- Store timestamps as UTC and display dates/times in `America/Los_Angeles`, including daylight-saving changes.
- Calendar-only fields use validated YYYY-MM-DD strings, not timestamps; shift clock times are Pacific wall times.
- Future volunteer queries must use `volunteerProfilePublicColumns` and the public schema/serializer. Never return a raw profile containing adminNotes. Never return passwordHash or tokenHash to a client.
- `isActive = false` means a deactivated user; authentication refuses sign-in and the verified-user middleware also blocks existing sessions.
- The seed uses stable UUIDs, a transaction, and conflict-do-nothing inserts. Reruns never delete rows, reset credentials, or overwrite edited fixtures.
  **Why:** repeatable dummy data must not destroy existing development work.
- New seed passwords use bcrypt cost 12. Existing scrypt fixture hashes remain usable and are upgraded only after a successful sign-in; rerunning the seed never overwrites passwords. Dummy volunteers receive randomized, undisclosed passwords; only the specified development admin credential is known.

## Development fixtures

- One verified admin and 18 fictional volunteers: 4 applicant, 3 in_training, 10 active, 1 inactive. All emails use example.org and phone numbers use the reserved 555-01xx fictional range.
- Twenty weekday slots (09:00–11:00, 11:00–13:00, 13:00–15:00, 15:00–17:00), capacity two; 18 standing assignments across the active volunteers leave intentional gaps.
- Two occurrence skips and one upcoming observed US federal holiday closure. The closure is dummy data, not an Alliance holiday policy.
- Two messages with recipients, and three documents, three articles, and three links; two links are quick links with placeholder URLs.
- Three clearly marked placeholder PDFs are generated under the frontend's `public/seed-resources/`. These are static seed fixtures, not an upload or document-storage feature.
- The seed does not send mail or generate live auth tokens.

## Email rules

- Every feature must call `sendEmail` from the shared email service. Do not import Postmark or call its API anywhere else.
- Live delivery requires both `POSTMARK_SERVER_TOKEN` and `EMAIL_FROM`. With either missing, the full recipient, subject, text, and links are printed clearly using the email logger; no external email is sent.
- The official Postmark SDK uses the outbound message stream and sends both HTML and plain text. A token is never logged.
- Use `createEmailTemplate` to generate HTML and plain text together. Copy should thank people for their time, name the specific action, and avoid impersonal system language.
- Successful provider acceptance is recorded as sent with its provider ID. Console-only emails are logged. Failures return `{ ok: false, error }` instead of throwing.
- Keyed emails are deduplicated by type, recipientUserId (including null), and relatedId for both sent and logged records. A PostgreSQL session lock makes checks safe across workers. A console-logged key remains handled even if Postmark is enabled later; use a new key for a deliberately new email.
- For email-only sends without a user ID, callers should use recipient-specific related IDs; different addresses with the same null user and related ID are intentionally the same deduplication key.
- Failed keyed attempts can be retried using the same log row. Unkeyed emails are not deduplicated.
- A durable audit row is created before delivery, temporarily marked failed with an explanatory unconfirmed-delivery message because the model has no pending status.
  **Why:** no external email should be attempted without a durable audit trail, including if the process stops during delivery.
- Database outages fail closed without sending. An unavailable DB cannot record a new row; the service reports the failure to the caller and server logger. A provider acceptance followed by persistent audit-write failure must be reviewed before retrying, since delivery and database writes cannot be one atomic transaction.
- Real provider delivery has not been tested. Before launch, configure an approved sender securely and obtain approval for the recipient/content of a controlled delivery check.

## Authentication rules and operation

- Auth pages: `/signup`, `/verify-email`, `/verify`, `/signin`, `/forgot-password`, `/reset-password`. Public forms use PublicLayout. `/onboarding` and all `/dashboard/*` paths require a verified account and successful protected `/api/me` response.
- The server uses express-session and connect-pg-simple with the `sessions` Postgres table, SESSION_SECRET, and Secure/HttpOnly/SameSite=Lax cookies. New passwords are bcrypt cost 12; minimum 8 characters, maximum 72 UTF-8 bytes to avoid silent bcrypt truncation.
- Every API request passes the explicit access-policy registry before any handler. Declare the HTTP method, path, and guard for each new route; undeclared paths are denied even to administrators. Guards are `requireAuth` (signed in, verified, active), `requireAdmin`, and `requireVolunteer`. Only the listed authentication endpoints, health, and fixed development email check are public.
- `/api/me` derives ownership exclusively from the signed-in user, ignores requested user IDs, and excludes password hashes, Google subjects, session versions, and volunteer adminNotes. All future volunteer resource queries must derive ownership from the current user rather than client-supplied IDs. Future schedule projections must not expose other volunteers' names, emails, or phones. No schedule endpoint is currently declared.
- Signup atomically creates a volunteer user and applicant profile, then sends verification through the shared email service. Email failure leaves the account available for resend and is not presented as successful delivery.
- Verification/reset tokens use random 32-byte values; auth_tokens stores only SHA-256 hashes. Verification lasts 48 hours, reset lasts one hour, and transactional consumption enforces single-use even under concurrent requests. Resends invalidate older verification tokens.
- A session version is checked against the current user on every protected request. Password reset and verification increment it, invalidating older sessions; sign-in regenerates the session ID and updates lastLoginAt. Deactivation blocks sessions regardless of verification.
- Obtain CSRF from GET `/api/auth/session` before mutations. Send `X-CSRF-Token` and same-origin credentials; refresh bootstrap after session-changing operations. Mutations also reject mismatched Origin headers. Signout destroys the stored session.
- Postgres rate counters survive workers/restarts. Sign-in: 10/IP and 8/email per 15 minutes. Reset requests: 10/IP and 5/email per hour. Resend: one/minute and five/hour per user, with an additional IP limit. The initial signup email starts the minute cooldown, not the five-resend hourly quota.
- Verification/reset links use APP_ORIGIN. It must be an HTTPS origin with no path/query. Development may default to the runtime development domain; production MUST explicitly configure the actual published origin. Never construct production links from a development domain.
- Google uses authorization code exchange, state, nonce, PKCE, and Google's verified ID-token/email checks. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET securely. Register `${APP_ORIGIN}/api/auth/google/callback` as the web client's redirect URI. Tokens from Google are not persisted.
- Existing verified local accounts can be linked by verified Google email. Reclaiming an unverified volunteer registration replaces its potentially attacker-chosen password with an unknown random bcrypt credential, invalidates tokens/sessions, and clears the unverified phone. Pending admins cannot bypass invitation acceptance through Google, ordinary verification, or password reset. Google-only verified users can establish a local password through the reset flow.
  **Why:** automatically verifying an old unverified registration while preserving its password/sessions would enable pre-registration account hijacking.
- Live Google consent/token exchange has not been tested because credentials are absent. The UI must remain honest about availability; do not simulate a Google login.
- Backend auth checks: `pnpm --filter @workspace/api-server run test:auth`. They refuse non-development NODE_ENV, use only temporary example.org accounts and reserved IPs, force console-only email in their process, and clean up their own fixtures. Email checks: `pnpm --filter @workspace/api-server run test:email`.

## Administrator access and team management

- Verified admins land on `/admin`; `/admin/team` lists, searches, and paginates admin and volunteer accounts. Both activation directions require a confirmation dialog. Volunteers accessing any `/admin/*` path are redirected to `/dashboard`; anonymous and unverified visitors go to `/signin` and `/verify-email`.
- Admin invitations create active but unverified pending admins with an unknown random bcrypt password. Only the one-time invitation sets their chosen password, verifies their email, and establishes an admin session. Invitation tokens are random 32-byte values stored only as SHA-256 hashes, expire after seven days, and are sent through the single email service.
- Renewing an active pending invitation revokes its prior token. Existing volunteers or verified admins cannot be promoted/reinvited using this form. Inactive pending admins must first be reactivated, then invited again. Email delivery failure leaves a pending account and an honest retry message.
- An admin cannot deactivate themselves or the last active, verified admin. Pending invitations do not count toward that safeguard.
  **Why:** an unaccepted invitation does not provide anyone usable administrative access.
- Administrator writes lock active verified admins in a consistent order and recheck the actor's session version. Deactivation increments the target's session version, deletes all their stored sessions, and revokes unused authentication links atomically. Reactivation does not revive old sessions or links. Token consumption locks the user before the token to match deactivation and invitation renewal.
- First-time bootstrap command: `npm run create-admin -- email@domain.org "First" "Last"`. It creates a pending admin and prints a private, seven-day invitation link. It refuses once an active verified admin exists; use `/admin/team` thereafter. Production must have `APP_ORIGIN` set to the actual HTTPS published origin and use the production database/environment. Do not seed development dummy users into production.

## Volunteer onboarding

- `shared/onboardingQuestions.ts` is the question source for the two-step form, Zod validation, administrator review, and CSV columns. Question IDs are the JSON answer keys; keep IDs stable when only changing wording. Optional `profileField` mappings maintain county and availability notes without hardcoded question IDs.
- Verified volunteers without completed onboarding are redirected from volunteer pages to `/onboarding`. Progress saves to the database between steps and through debounced saves/“Save progress”; no questionnaire/contact data is stored in browser local storage.
- `/admin/team` → Volunteers offers “Review onboarding” and a CSV download. Only admins can review another volunteer or export personal information. CSV cells neutralize spreadsheet formulas.
- Agreement resources must be published in the exact category `Agreements`, with titles `User Agreement` and `Safety Guidelines`. Both must have readable content before submission is enabled. Missing resources are not replaced with made-up legal text. Current resource viewing supports text articles, HTTPS links/documents, and existing static seed PDF paths; private App Storage file downloads will need the resource-storage feature.
- Completion records the current `appConfig.agreementVersion` (default `v1`), acknowledgment time, completion time, and a deduplicated welcome email. It does not approve the volunteer or bypass training/background checks. Late drafts cannot overwrite completed onboarding.
- Checks: `pnpm --filter @workspace/api-server run test:onboarding`. These use owned development-only fixtures, force console-only email in their process, and clean up their own records.

## Volunteer home and profile

- `/dashboard`, `/shifts`, `/messages`, `/resources`, and `/profile` use the volunteer AppLayout with five mobile tabs. Each requires a verified, active user account and completed onboarding; a volunteer-profile status of inactive is distinct from account deactivation and shows a contact-the-team message.
- Dashboard cards use the current profile status, certification/background-check states, own standing assignments, active-only published quick links, and own unread message recipients. APIs under `/api/volunteer/*` derive identity from the session and require completed onboarding on the server.
- Shift dates are a read-only projection of existing assignments, with skips and organization closures applied and times interpreted in `America/Los_Angeles`, including daylight-saving transitions. The projection is not a booking module: `schedulingOpen` remains false, and `/shifts` explicitly says selection is not open. Upcoming-shift components are reusable by the future scheduler.
- Profile edits are limited to name, phone, county, availability notes, and answers validated by the shared question configuration. County/availability mappings stay synchronized; cleared notes are saved as null. Email, role, volunteer status, certification, background check, agreement acknowledgment/version, and admin notes cannot be changed through this endpoint.
- Password changes require the current password, use bcrypt cost 12, and invalidate all sessions and unused auth tokens. The volunteer must sign in again; older passwords/sessions are rejected. Attempts are limited by user and IP.
- Messages are limited to the current user's recipient rows; opening a message marks only that recipient read. Resources are read-only published content, with quick links hidden from nonactive volunteers. Resource management, sending messages, and shift booking are separate later modules.
- Checks: `pnpm --filter @workspace/api-server run test:volunteer`; fixtures are development-only and cleaned up. Private volunteer query caches are removed when authentication state is refreshed.

## Admin volunteer roster and exports

- `/admin/volunteers` uses a desktop table and mobile cards, with name/email/normalized-phone search, status/county/certification/background filters, server pagination, and read-only detail links using user IDs. Global summary chips intentionally stay stable while filters change.
- Attention means active profile with zero held shifts; a certification expiration from today through 30 days ahead inclusive; pending background checks submitted more than 14 calendar days ago; or incomplete onboarding. Dates and report filenames use the Pacific calendar. Expired certifications are not silently reclassified as “expiring within 30 days.”
- A held/active assignment has an active slot and no end date before today, excluding `admin_removed` cancellations immediately. Future-start reservations count as held; ordinary end dates are inclusive. Rosters include all volunteer-profile statuses and account activation states; inactive profiles with assignments remain visible to staff.
- Both CSV downloads are generated server-side and require an active, verified admin session. Exports respect current filters but ignore pagination and bulk selection. The roster includes every profile field, raw answer JSON (preserving legacy answers), one column per configured question, contact/verification/login metadata, and formatted held shifts. It includes internal admin notes: share only with authorized staff. Authentication secrets/hashes are never exported.
- The schedule CSV has one row per held assignment, local weekday/time, start/end dates, and sorted future skip dates within that assignment's date range. All CSV cells are quoted/escaped and formula-neutralized; files use UTF-8 BOM and dated download filenames.
- Bulk selection retains volunteer user IDs across pages and clears on filter changes. “Message selected” calls the messaging hook and shows an explicit coming-later notice; no messages are sent in this step.
- Validation: `pnpm --filter @workspace/api-server run test:roster`, with owned, development-only fixtures and cleanup.

## Admin volunteer detail workflow

- `/admin/volunteers/:userId` provides contact links, joined/login dates, confirmed status transitions in any direction, training/background tracking, configured onboarding answers/agreement, staff shift/week-off controls, sent-message history/read status, autosaved staff-only notes, and the latest 50 activity entries.
- Activation is server-enforced: verified email, completed onboarding, acknowledged agreement, complete certification, and cleared background check. The API rejects override fields and returns all missing requirements. Approval generates a warm `/shifts` email through the single email service, related to the status activity ID; UI distinguishes dev-logged from actually sent mail and reports delivery failures without undoing approval.
- Inactive confirmation snapshots every unended assignment, including future reservations and inactive slots. The API compares the confirmed IDs and profile revision, then updates status, assignments (`admin_removed`, Pacific end date today), and activity atomically. Cancelled reservations retain their original start dates; only admin cancellations may end before a future start date. Ordinary end-date ordering remains enforced, including when the ending reason is null.
- All status changes record actor, previous/new status, time, and released assignments in `activity_log`; tracking saves also record changed fields. Notes are not copied into the activity feed. Status/tracking revisions and exact prior-note compare-and-set prevent silent staff overwrites; drafts survive conflicts, and blank date inputs explicitly clear nullable columns.
- Schedule writers acquire the shared schedule lock before user/profile and slot row locks, so bookings, staff overrides, account deactivation, and inactive releases cannot race. The uncovered-shift integration runs after commit and calculates actual coverage reductions before sending combined alerts.
- Development schema changes have been applied; production schema changes use Replit's normal Publish diff, never startup or deploy-time migration scripts.

## Schedule settings and occurrence rules

- `/admin/schedule/settings` is staff-only: weekday slot CRUD (capacity 1–10, same-day times), advisory overlaps, additive Monday copying, and closed-date add/remove. Copying uses active Monday templates without scheduled retirement, preserves matching duplicate-slot multiplicity, and never overwrites existing slots or assignments.
- Assignment counts include future reservations and count unique volunteers. Reducing capacity below that count is a validation error, not a stale-edit conflict. Slot edits compare the original revision and exact assignment IDs; a stale confirmation requires explicit review.
- Ending a slot now cancels all ongoing assignments immediately with `admin_removed`, Pacific end date today, one centrally sent/logged email per volunteer, an activity entry, and the shared uncovered-shift hook. Inactive slots do not generate gap warnings. Reactivation never resurrects cancelled assignments.
- Keeping assignments through a date stores a scheduled retirement and inclusive assignment end dates. The slot remains effective through that date; afterwards it is excluded even without a background job. Future reservations starting after the cutoff are cancelled now and emailed; current assignments continue through the cutoff. Pending-retirement slots are for existing assignments only: future booking code must reject new seats whenever `retireAfterDate` is set. Ordinary edits preserve the date; cancelling the retirement does not extend assignment end dates automatically.
- `src/server/scheduleService.ts` is the single pure occurrence engine, bound to an immutable copied data snapshot via `createScheduleService`. Its `getOccurrences(fromDate,toDate)` uses inclusive Pacific calendar dates; `getOnShiftNow(at)` uses start-inclusive/end-exclusive instants; `getUpNext(at)` returns all slots tied for the earliest future start; `getCoverage(weekStart)` returns a seven-day range with distinct-person counts and empty/under-capacity flags. Clock defaults are injectable in tests.
- Skips remove only the applicable assignment/day. Closures and effectively inactive slots emit no occurrences and therefore no reminder or coverage-gap candidates. Future reminder/alert jobs must use these methods, never construct a separate calendar. Existing volunteer upcoming-shift projections now delegate to this engine and are scoped to the signed-in volunteer's assignments; public APIs must never expose another volunteer's assignment/personnel records.
- Schedule mutations take a shared transaction advisory lock. Future booking writers must acquire it before user/profile/slot row locks; use the user-then-profile lock order shared with profile-status changes. This prevents booking, capacity, and deactivation races.
- Run `pnpm --filter @workspace/api-server run test:schedule` for the Vitest service/API suite. It covers both DST transitions, overlapping slots, skips, closures, retirement, capacity, confirmation conflicts, mail logging, and additive/idempotent copying. Closed-date HTTP values remain calendar strings, not midnight-UTC timestamps.

## Automated shift reminders

- `src/server/jobs.ts` schedules `*/15 * * * *` with node-cron in America/Los_Angeles only when `RUN_JOBS=true`. Manual staff checks and secret-authenticated external checks intentionally work even with automatic scheduling disabled.
- Reminder candidates come from the shared occurrence engine: assignment dates, week-offs, closed dates, active/retired slots, active volunteer profiles/accounts and verification all apply. Eligibility is freshly checked immediately before each delivery.
- The main reminder uses elapsed `appConfig.reminderHoursBefore` hours and a half-open 15-minute start window. Its related ID is `assignmentId:Pacific-date:24h`, regardless of configured hours. Optional morning checks run during the configured Pacific hour for today's not-yet-started occurrences and use `:am`; later quarter-hour checks retry failures without repeating confirmed mail.
- A cross-process PostgreSQL advisory lock prevents overlapping checks. Central email-service deduplication prevents sent/logged retries across workers/restarts. Each email batch settles before the job lock is released. Interrupted run diagnostics are recovered by the next successful lock owner.
- Persisted `reminder_job_runs` diagnostics power `/admin/notifications/jobs`. Seven-day delivery totals count actual standing-shift reminders; labelled test emails to the authenticated admin do not inflate those totals. Sent, logged and failed are distinct. Staff mutations require admin authentication plus CSRF.
- Machine callers POST `/api/jobs/run` with the `JOBS_SECRET` header (at least 32 characters). This is the sole narrow, separately guarded machine route exempt from session/CSRF. Missing/unconfigured credentials fail closed. Secrets are never in URLs or browser code. Production rejects clock overrides; development staff checks accept an ISO `?at=` for controlled testing.
- The existing published app is Autoscale, which cannot guarantee an in-process timer stays awake. Use an always-running API or a Scheduled Deployment every 15 minutes in America/Los_Angeles. `pnpm --filter @workspace/api-server run reminder-trigger` performs the HTTP POST using `JOBS_RUN_URL` and `JOBS_SECRET`; it does not start the server or connect to a database. `reminder-check` is a direct database CLI alternative.
- Production `RUN_JOBS=true` and the production `JOBS_RUN_URL` are configured. Development is enabled only for testing and restored afterwards. `JOBS_SECRET` is configured through Secrets; the authenticated trigger was verified through the development proxy, while unauthenticated requests return 401. Publish the updated code before using the production trigger. Schema changes are applied through publishing, not production startup DDL.

## Messaging

- `/admin/messages` supports active-volunteer blasts, all-status blasts, roster selections, and single recipients (including launching from volunteer detail). The active audience requires an active account and active profile; all-status and explicitly selected audiences may include inactive/unverified volunteer accounts. Admin accounts are never recipients of volunteer messages.
- Preview counts are bound to the canonical draft and exact recipient IDs. Sending revalidates the audience and returns a conflict if it changed. A client request UUID is the persisted message ID; retrying that ID preserves the original message/recipient snapshot instead of duplicating it. Portal recipients are committed atomically before email delivery.
- Optional email copies use bounded batches through `src/email.ts`, shared branding and safe Markdown, one notification per recipient on initial send, and deduplication by message ID. Failed attempts remain logged; same-ID retries can retry failures while skipping sent/logged recipients. Reply-To is the configured valid program contact address, otherwise the authenticated sender's email.
- Supported Markdown is bold, HTTP(S)/mailto links, and ordered/bullet lists. Raw HTML is escaped and other URL schemes are rejected. The same renderer is used for preview, email HTML/plain text, and inbox reading.
- `/messages` only returns the current volunteer's recipients; opening marks only their row read, preserves the first read timestamp, and refreshes navigation/dashboard unread state. No in-app reply endpoint exists. Staff lists, detail history and per-recipient receipts refresh every minute.
- `appConfig.adminContact` is the preferred public program contact. It is currently unset because no program-specific address was supplied; the inbox falls back to the existing active, verified staff contact rather than inventing an address.
- Development `message_audience` gained `active` and `selected` values, preserving existing `all`/`single` seed data. Production schema changes go through publishing, never startup DDL.

## Volunteer standing shifts

### Staff overrides and coverage notifications

- Staff controls are shared by the master schedule drawer and volunteer detail. Only active accounts/profiles meeting all approval requirements can be assigned. Staff can exceed the configured shift maximum or slot capacity with an explicit override plus a nonblank reason, audited alongside the limits exceeded. Neither checkbox nor reason bypasses eligibility or overlapping standing shifts.
- Staff can remove standing assignments with optional volunteer email, and add/undo weeks off without the volunteer's 24-hour cutoff. All actions write an activity event. Account deactivation also ends reservations and checks coverage; reactivation does not restore released seats.
- Release alerts compare actual before/after occurrences, send one combined email per event to all active admins, and deduplicate by event ID. Weeks off use a seven-calendar-day window; other releases use fourteen days. Only reduced counts below capacity trigger a message. Closed and inactive slots produce no alerts.
- The daily digest uses `app_settings` and checks at 7 AM Pacific Monday–Friday. It records the processed Pacific date (including empty checks), uses that date as each recipient's notification related ID, and retries failed deliveries without repeating sent/logged emails. A cross-process database lock prevents overlapping runs. The API polls every 30 seconds and catches up once after a restart after 7 AM.
- **Production scheduling:** in-process timers require an always-running API (Reserved VM), not a web process that sleeps with no traffic. Alternatively schedule `pnpm --filter @workspace/api-server run coverage-digest` with `0 7 * * 1-5`, timezone `America/Los_Angeles`, and the existing production environment. No production deployment configuration was changed by this build.
- `app_settings` was created in development, matching the shared schema. Publish applies the production schema change; do not add startup DDL or a production migration command.

- `/shifts` is verified-volunteer self-service, including an explanation for applicants, inactive profiles, or missing agreement acknowledgment. Availability exposes counts and only the caller's assignment/skip IDs; no other volunteer contact information. The contact link uses the oldest active, verified staff account.
- Booking/change/drop/skip/undo all recheck the user/session and profile inside a transaction. Writers follow the shared advisory schedule-lock order, lock the user/profile, and row-lock the target slot; capacity is reread after that slot lock. Standing reservations, including future starts, consume capacity and the configured maximum. Skipping an occurrence never frees its standing seat.
- New starts must be future, match the weekday, fall within 28 calendar days, and avoid closures/retirement. Changes immediately release the previous assignment; drops require the configured minimum to remain. Since end dates are inclusive, immediate cancellation uses yesterday with `changed` or `dropped`; the assignment-date CHECK permits pre-start ends only when an ended reason exists.
- Rebooking an identical cancelled reservation reuses its unique row, records the prior cancellation in activity, and clears future weeks off from that cancelled enrollment. Confirmation emails go only through `email.ts`, use the activity ID for deduplication, and report any delivery failure separately from a successfully saved shift.
- Weeks off require at least 24 elapsed hours before the Pacific shift start; undo remains available until the start. Own standing cards show the next four potential occurrences with weeks-off markers and all upcoming stored skips. The dashboard uses actual occurrences, excluding skips and closures, and is invalidated after all self-service changes.
- The development assignment CHECK was explicitly updated and verified. Keep the schema source in sync and apply production schema changes through Publish; no runtime/startup DDL is used.

## Coordinator dispatch and master schedule

- `/admin` is the live coordinator dispatch view; `/admin/schedule` is the Monday–Friday master calendar with a phone day picker. Both read admin-only, no-store endpoints and refresh every 60 seconds while foregrounded, plus on window focus. The displayed update time is the server snapshot time in America/Los_Angeles; failed refreshes retain the last snapshot with an explicit not-live warning.
- The coordinator projection uses `scheduleService` for current/next occurrences and coverage. The weekly display uses a skip-free/closure-free shadow of the same engine solely to show "week off" names and closed cells; counts and gaps always come from the actual engine, never the shadow. Contact data is joined only inside the admin projection, not added to the shared scheduling engine.
- Closed days remain visible even without configured slots and never contribute open spots. Repeated current contacts across overlapping assignments are deduplicated in the dispatch UI, retaining all shift end times. Drawer details follow the latest polled block; removed blocks do not retain old personnel details.
- Weekday time columns share a locally expanding axis so short slots and long volunteer lists fit without extending a card beyond its actual end time. Overlapping intervals use separate lanes, including transitive overlap groups. Assignment/skip mutation actions remain for subsequent schedule steps.
- Needs-attention rules are shared with the roster. Overview queries select only required contact/attention fields, omit notes and answer blobs, bound recent activity, and read a repeatable snapshot; no persistent private-data cache is used. Settings writes invalidate overview and calendar queries immediately in the current client.

## Optional brand assets

Place the logo at `artifacts/alliance-volunteer-portal/public/brand/logo.svg` and the licensed Lulo Clean font at `artifacts/alliance-volunteer-portal/public/fonts/LuloClean.woff2`. Restart the frontend workflow after adding either asset.

Absent assets use the display-font wordmark and Montserrat 800. Open Sans 400/600/700 and Montserrat 800 load from Google Fonts. Do not invent a replacement logo.
