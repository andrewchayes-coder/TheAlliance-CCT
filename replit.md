# Community Care Team Volunteer Portal

Mobile-first volunteer management for The Alliance's Community Care Team.

## Product context and v2 model

- The pilot is 12–15 volunteers in Placer County, growing to about 60 across five counties. Excellent phone usability is required. County choices are not a final service-area commitment.
- Volunteers are Resource Coordinators helping local families find support. Use warm, specific, dignifying copy; staff UI may say volunteer.
- The app writes only **onboarding / active / inactive**. Historical database statuses normalize to onboarding when read; their enum values and historical columns remain intact.
- Onboarding is a fixed profile: names, ten-digit mobile, DOB, home address, emergency contact name/relationship/phone. Resource Coordinators must be at least 18; the 18th birthday is accepted using Pacific calendar dates.
- County is staff-managed, defaults to Placer, and is not asked of volunteers. Start date is staff-editable; every transition to Active fills a missing start date with Pacific today, including reactivation.
- Completing a new profile automatically activates an Onboarding volunteer when email verification and all profile requirements are met, with one shift-signup welcome email. Re-submission and inactive volunteers never auto-activate. Staff can still change status manually. Questionnaire configuration is empty; certification, volunteer-facing background-check and agreement gates remain off.
- Background checks are recorded only by staff using the existing cleared/not_started status and cleared date. This optional record is never returned to volunteers, is not an activation/shift requirement, and adds no Needs-attention reason.
- Google OAuth is prepared but unavailable until configured; email/password works independently.

## Structure and runtime

- Frontend: `artifacts/alliance-volunteer-portal`, React/Vite, Wouter, TanStack Query and shared generated API clients.
- Backend: `artifacts/api-server`, Express, PostgreSQL/Drizzle. Shared model/configuration lives under `shared`; libraries live under `lib`.
- Managed workflows: `artifacts/alliance-volunteer-portal: web` and `artifacts/api-server: API Server`. Use the artifact routing helpers, not hardcoded localhost/browser API URLs.
- The separate registered Canvas/component-preview artifact is workspace design infrastructure, not shipped portal UI. Preserve it; exclude its scaffold from CCT brand/legacy-flow scans.
- Regenerate API contracts with `pnpm --filter @workspace/api-spec run codegen` after contract changes. Keep server validation, generated DTOs and client use consistent.

## Run, verify and publish

- `npm test` / `pnpm test` runs all API Vitest tests, the client coordinator projection tests, and all TSX/Node suites in an isolated development schema with external email disabled. It refuses production.
- `pnpm run typecheck` checks libraries and applications. Build the API and frontend before release.
- Development fixtures only: `NODE_ENV=development SEED_DATABASE_ENVIRONMENT=development npm run seed`; repeat safely, then run `NODE_ENV=development SEED_DATABASE_ENVIRONMENT=development pnpm --filter @workspace/scripts run verify-seed`.
- The seed contains 1 ordinary dummy admin, 18 complete fake volunteer profiles with canonical statuses, and 40 standing slots. Built-in QA accounts are separate synthetic identities. Never load these ordinary fixtures into production.
- The smoke runner uses its own schema/API, exercises the v2 journey and collects Lighthouse reports under ignored `generated-artifacts`. No live email or shared operational data should be touched by regression tests.
- Production remains **Autoscale**, **RUN_JOBS=false**, with cron-job.org calling `POST /api/jobs/run` every 15 minutes using **X-Jobs-Secret**.
- **Replit Publish owns schema changes.** Do not restore startup migration hooks, invoke Drizzle migrate, create a baseline journal, run production seeds or copy development data. Migration files are reference records only.
- Before Publish, a newly added status enum value needs its separate committed SQL statement. DEPLOY.md contains the operator-reviewed enum/CHECK runbook, required configuration, first admin setup, external cron settings and rollback instructions. Never execute production SQL as part of ordinary workspace tests.
- Production uses its own managed database and HTTPS `APP_BASE_URL`. Secrets belong in secure environment configuration, never source, screenshots or docs.

## Authentication, roles and privacy

- Email/password uses bcrypt cost 12, PostgreSQL sessions, secure/httpOnly/SameSite=Lax production cookies and origin/CSRF enforcement. Unverified or deactivated users cannot enter protected APIs.
- Every registered API route declares a guard; new routes default-deny. Admin routes require admin access. Volunteer reads/writes are scoped to that user.
- Verification/reset/invitation tokens are random, hashed, single-use and expiring. Authentication and administrative sends have server rate limits. Recovery flows avoid account enumeration.
- Deactivation invalidates sessions and unused authentication links. Staff cannot deactivate themselves or the last active verified administrator. Use the create-admin operator command only in its intended database context.
- A session-changing action must refresh client identity and coordinate route guards before navigation. Do not keep a previous account's private query data after switching.
- Schedule endpoints visible to volunteers expose counts and their own assignments only, never peer contacts or staff email. Public team contact comes from appConfig. Staff notes are stripped from every volunteer-accessible response.
- Staff profile-edit audit details contain field names, not DOB, address or emergency-contact values. No generic service-worker/private-data caching.

## Synthetic QA personas

- Exactly five: Admin; Volunteer · Active; Volunteer · Active, no shift; Volunteer · Onboarding, ready to activate; Volunteer · Onboarding, new.
- Development is always enabled. Production is enabled only when `QUICK_LOGIN_ENABLED`, trimmed and lowercased, equals true.
- While enabled, **anyone can open these personas from /signin, including the real admin view**. This is intentional during testing. Reset after production QA, then turn the switch off and republish before inviting real volunteers.
- Only flagged, active, verified test users of the expected role are eligible. Ordinary users must never be converted. CSRF/origin checks, session regeneration, 30/IP/hour login limits and audits remain.
- Replaced personas reuse existing synthetic users and history; repeated preparation preserves tester progress. Keep legacy email aliases until both production identities have migrated and no old alias remains.
- Production setup/reset does not occupy standing capacity automatically. Tester-selected standing/one-time reservations consume actual capacity and carry TEST labels.
- Reset releases QA standing shifts, cancels QA one-time claims using cancelledAt, clears QA skips/inbox/progress and invalidates QA sessions. Never clear real-user data.
- Test emails log suppressed status without delivery and do not count against usage. Test identities are excluded from normal roster counts, broadcasts, digest recipients and CSV exports. Persistent TEST banners and account switching are present on all signed-in layouts.

## Scheduling and coordinator dispatch

- Standard grid: Mon–Fri, starts 9–16, two-hour slots through 18:00, capacity 2 (40 total). Hourly overlap is intentional. The standard-grid loader is idempotent.
- Shared schedule logic interprets date-only values and instants in America/Los_Angeles, including DST. Occurrences honor starts/ends, skips, closures, retirement, date-specific blocks and custom shifts.
- Standing sign-up/change locks the slot inside a transaction. Enforce active/verified/completed eligibility, capacity, configured max/min and non-overlap. Future reservations consume standing seats; a week off does not free a standing seat.
- Changes release the old commitment immediately. Reusing a cancelled enrollment preserves history but clears its stale future weeks off. Cancellation-before-start is permitted only with an ended reason; keep the date CHECK aligned.
- Week-off/cancellation self-service requires at least 24 elapsed hours before the shift. Inside the cutoff, direct volunteers to the public Community Care Team contact.
- Admin overrides of standing caps/capacity require an explicit audited reason; overlap is never overridden. Every assignment/removal/week-off writes activity. Date-specific blocking confirms and notifies affected volunteers.
- One-time shifts are separate from standing counts, use date-specific capacity/non-overlap checks and appear in now/next, coverage, personal upcoming shifts, CSV and reminders.
- `/admin` is the coordinator's primary Find Help dispatch tool. It refreshes every 60 seconds while foregrounded and on focus. Deduplicate contacts across overlapping shifts; display every relevant end time.
- Display “outside shift hours” separately from an uncovered operating period. Failed refreshes may retain the last snapshot only with an explicit not-live warning; never present a stale schedule as live.
- Desktop calendar uses overlap lanes; phones use a day picker/list. Coverage counts come from actual eligible occurrences, while a separate display projection preserves skipped names and closed cells.
- Needs attention: active with no shift; onboarding with an incomplete profile for over 7 days; or onboarding for over 30 days. Closed/blocked dates do not produce coverage warnings.

## Email, jobs and notifications

- All delivery goes through the single email service and central emailIdentity. Postmark outbound identity comes only from configured From/Reply-To; legacy per-message staff addresses are ignored.
- Development without provider configuration logs full text/links plus From/Reply-To. Production fails closed if required email configuration is incomplete and must not log recovery credentials.
- notification_log records sent/logged/failed/suppressed and uncertain delivery. Deduplication protects repeated confirmed sends. Uncertain delivery is never automatically resent or manually retried without reconciliation.
- External jobs have an approximately 20-second application budget. No new queue/table: unfinished recipients remain unsent and a later 15-minute call catches them up. Closed/blocked/skipped/inactive occurrences are excluded.
- The daily digest is Pacific 7 AM on weekdays, controlled by staff settings; no gaps means no digest. Use the date key to prevent duplicate sends. Immediate alerts report actual coverage reductions rather than pre-existing gaps.
- Auth links must be regenerated for safe retries. Usage counts only sent/logged rows; historical dedupe must not inflate usage. Test mail/reminder actions remain explicit and staff-only; operator production checks target a verified administrator.
- Node-cron is a development/testing alternative only for this deployment. Production runs no built-in scheduler even if the flag is mistakenly enabled.

## Roster, messages and resources

- Roster: desktop sticky table / mobile cards, contact links, city/start date/shifts/login, optional staff-private columns with safely persisted preferences, sorting and v2 filters. Detail pages show editable private profile/start/county and staff-only autosaving notes.
- CSV is server-generated/admin-only, uses readable headers and formula escaping, includes current profile and standing/custom schedules, and omits disabled tracking fields and QA identities by default.
- Staff messages support preview/counts, markdown, single/selected/status audiences, optional central-service email and read receipts. Volunteers have read-only inboxes and the public team reply guidance.
- Documents are private authenticated PDF/DOCX uploads (15 MB maximum), articles use sanitized markdown, and quick links require HTTPS. Staff can reorder/publish/replace/delete; volunteers see published content only.
- Use native anchors for document/new-tab links because this router intercepts target=_blank clicks. Do not emit public object-storage URLs for private documents.
- Agreement categories/legacy data remain available, but agreement renewal is disabled by the v2 configuration and is not an onboarding/shift gate.

## Approved CCT brand and accessibility

- Open Sans 400/600/700, sentence-case headings, navy #06365D, Alliance Blue #0175aa, gray #E6E6E6 and white. Blue small text belongs on white, not gray; labels are navy.
- Approved assets are bundled under the portal public/brand folder and served at /brand before sessions, with immutable caching. Version filenames if replacing artwork. Never invent fallback logos/wordmarks.
- White desktop headers use the horizontal lockup, phones use the mark, and public pages use the stacked lockup. Email headers use the configured app URL plus the bundled horizontal PNG.
- Visible focus, real labels, keyboard-operable dialogs/grids, polite announcements and 44px targets are required. Test 375px and 768px without horizontal scrolling.
- `/style-guide` and time-override/test-email routes are development-only. The public root is a restrained portal entry. Manifest/icons allow home-screen installation without private-data caching.

## Release documentation

QA-CHECKLIST.md is the workflow-based UAT tracker; docs/Alliance Persona Test Run.md is the unchanged master. Keep matching IDs, NEW/CHANGED tags, optional milestone/notification tests and a complete coverage table.
CHANGELOG.md records delivered releases; DEPLOY.md is the operational source of truth.
