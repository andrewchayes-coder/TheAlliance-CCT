# Changelog

User-facing releases and migration/operating changes are recorded here. Add new releases above older entries with Added / Changed / Fixed / Security sections as applicable.

## v1.5.0 — 2026-10-23

- Add to Calendar: each Resource Coordinator gets a private calendar link for Google Calendar, Outlook, Apple Calendar or any app that subscribes by URL; it updates on its own as shifts change. Volunteers can reset their link; staff can see whether it's connected. New table calendar_feeds (additive).

- Volunteer shift sign-up now offers Recurring weekly or One time, with date-specific availability, clear confirmation emails and one-time cancellation. One-time bookings do not count toward the weekly shift limit.

- Admins can archive and restore accounts from volunteer details and Team. Archived accounts are hidden from normal lists and new message audiences; hours, messages and history remain available. Archiving disables sign-in, ends sessions and releases future shifts. Restoring does not reactivate sign-in or restore shifts. Self, last-active-admin and built-in QA account protections apply. Additive `users.archived_at` field; no permanent account deletion.

## v1.4.1 — 2026-10-15

- Volunteers who can't book yet no longer see greyed-out Claim buttons on one-time shifts; Recent activity updates right away after staff remove hours. No database changes.

## v1.4.0 — 2026-10-15

- Reports (Alliance UI review, Oct 14): Admin → Reports shows hours per Resource Coordinator and total team hours for any month, shifts not logged yet (with a button to message those volunteers), a 12-month trend, and two CSV exports. No database changes.

## v1.3.0 — 2026-10-14

- Hour logging (Alliance UI review, Oct 14): after each shift, Resource Coordinators confirm their hours on Home or My Shifts (one tap for the scheduled 2 hours, or enter a different number) for up to 14 days; staff can view, add, correct and remove hours on a volunteer's page. New table volunteer_hours (additive).

## v1.2.1 — 2026-10-14

### Changed
- Admin menu scrolls on phones so every item is reachable (Alliance UI review, Oct 14). Home-screen icon is now the Community Care Team logo (re-add the portal to your home screen to see it). Signing out always ends on the official sign-in page. No database changes.

## v1.2.0 — 2026-10-14

### Changed
- Volunteers become Active automatically when they finish their profile (Alliance decision, Oct 13): one welcome email with a link to choose a shift; staff can still set status by hand. Becoming Active always sets a start date if there isn't one (fixes the re-approved test volunteer case). Admin-only background check record (checkbox + date) with a roster filter, optional column and CSV columns; never shown to volunteers and not required for anything. Minimum age 18. Visitors on the old .replit.app address are sent to the official address. No database changes.

### Docs
- Docs: docs/Alliance Persona Test Run.md updated (v8).
- QA-CHECKLIST.md synchronized with all 136 master IDs and Fix 8 workflows.
- DEPLOY.md: updated the cron-job.org endpoint to `https://cct.defendingthecause.org/api/jobs/run`.

## v1.1.5 — 2026-10-12

### Changed
- Reminder jobs page: plain-language scheduler status (cron-job.org), a warning when scheduled runs stop or fail, the last scheduled run shown separately from manual checks, clearer count labels and notes. No database or job-behavior changes.

### Docs
- docs/Alliance Persona Test Run.md updated (v1.1.4 tests, ADM-39, PRD-12).
- QA-CHECKLIST.md synchronized with the updated master, including reminder-job health and guided volunteer review workflows.

## v1.1.4 — 2026-10-12

### Changed
- Onboarding volunteers appear immediately in roster Needs Attention as awaiting review. Volunteer detail provides a guided approval checklist with missing requirements, who completes each step, and links to the relevant sections; activation remains an explicit staff decision.
- Guided activation uses clear Approve as Active actions, refreshes roster and overview data, and distinguishes saved approval from approval-email delivery failures.
- Volunteer detail uses smaller, consistently top-aligned contact and date fields, with global CSS for safe email wrapping and accessible contact-link tap targets.
- A shared page header and consistent page layouts align titles, subtitles, actions, spacing, and responsive wrapping across the portal, including public authentication screens.

### Fixed
- Preserved request validators after reconciliation, including optional profile draft fields and the updated Needs Attention filters shared by roster and CSV exports.

### Docs
- QA-CHECKLIST.md re-synced with the Oct 12 master test list; all 13 master/app disagreements resolved.

## v1.1.3 — 2026-10-11

### Fixed
- Missing error codes on 422 responses now use `VALIDATION_FAILED` and preserve the specific validation message.
- Volunteer status changes refresh user-specific and general standing-shift controls and the master schedule, removing released shifts without a page reload.
- Start-date edits create one `start_date_changed` activity entry; profile-update entries exclude start date and are omitted for start-date-only saves.
- Volunteer Profile directs email changes to the self-service Email address section; onboarding retains its staff-contact wording.
- New slot capacity defaults to the shared Community Care Team standard of two; existing capacities remain unchanged.
- Admin test email and reminder buttons and their protected routes work in production, target only the signed-in administrator, and preserve TEST-account suppression with clear result copy.

## v1.1.2 — 2026-10-11

### Fixed
- Renamed the web app manifest to `/manifest.json` so production static hosting serves browser-compatible JSON without relying on Vite middleware.
- Staff schedule controls list only dates within a standing assignment's start/end period, while retaining stored future weeks off. Both staff and volunteer week-off actions return clear 422 errors for dates outside that period.
- Slot capacity guidance and server errors use correct singular/plural wording, including “1 volunteer is assigned.”

## v1.1.1 — 2026-10-11

### Fixed
- Fix 3 polish: hide disabled Google sign-in; serve the manifest with its proper MIME type; correct future-shift copy and weekend week defaults; distinguish QA personas across schedule/Team views and recipient search; format displayed phones, associate staff Profile labels, and simplify capacity guidance.
- Incomplete volunteer profiles redirect to onboarding from Shifts and all other volunteer pages, including My Profile. Complete, not-yet-active volunteers retain the explanation of booking eligibility.
- Quick-login role changes perform a fresh, base-path-aware navigation; a same-path guard redirect no longer shows an endless spinner.
- Display headings and labels remain white on navy dashboard and shift-confirmation cards.
- Onboarding drafts, volunteer profile updates, and staff Profile-card saves validate nonempty phone numbers, ZIP codes, dates of birth, and field lengths. Empty draft values remain allowed, and invalid saves return field errors.
- Shift confirmations and changes use the new **Shift** notification type, separate from welcome/approval emails, throughout notification filters and reports.
- Missing or unreadable documents return a friendly 404; staff resource lists show **File missing — replace it**. Production does not attempt to upgrade local development seed documents.

### Verification and deployment
- Added shared validation/API regression tests, missing-document coverage, repeat cross-role Playwright checks, and axe contrast checks for three dashboard states.
- Before Publish, run: `ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'shift';`
- The migration file is reference-only. Replit Publish remains the schema deployment mechanism; no startup migration hook was added and no production SQL was run.

## Unreleased — My Profile and staff account management

- Added the production seed-data purge SQL runbook with QA-preservation checks; restricted legacy seed-resource upgrade utilities to explicitly permitted development.

### Added
- My Profile for administrators and volunteers, including verified volunteers still onboarding.
- Name/phone editing, current-password-protected email changes, password changes and private profile photos.
- Staff account editing on Team and volunteer detail, with password-reset links rather than staff setting passwords.

### Security
- New email addresses require verification; the current address remains usable until confirmation.
- Confirmed email and password changes close existing sessions.
- Photos are decoded and re-encoded as PNG, resized, stripped of metadata and served only to their owner or staff.
- Test administrators cannot use these account-editing controls to change real accounts.
- Two nullable columns added; production schema remains managed by Replit Publish. No startup migration or production data backfill.

## v1.1.0 — Community Care Team refresh
### Added
- Five built-in test personas, quick-login role switching, persistent TEST indicators, suppressed delivery and QA-only reset.
- Community Care Team standard grid loader (40 overlapping weekday slots), date-specific shift blocks, and one-time shifts with volunteer signup and audited staff capacity overrides.
- One-time shifts in live dispatch, coverage alerts, reminders, schedule CSV and volunteer upcoming shifts; date blocks suppress operational occurrences without cancelling standing assignments.
- Staff roster with configurable per-admin columns, global sorting, contact links and new profile filters; private profile and inline start-date editors.
- Fixed, single-screen CCT profile onboarding with per-field draft saves, US address, past DOB and emergency contact details.
- Staff-editable volunteer start date with first-activation default and audited start-date/status changes.
### Changed
- Production quick login is now a single on/off switch (QUICK_LOGIN_ENABLED). The unlock key and unlock link were removed.
- Volunteer-facing contact guidance now uses the Community Care Team mailbox exclusively. Email sender identity is parsed and validated; Reply-To is centrally configured, never inherited from a message author.
- Master schedule uses a 30-minute grid with explicit odd/even-hour lanes, gray blocked occurrences and dashed-blue one-time shifts. Inactivation/deactivation also releases future one-time reservations.
- Roster attention counts now flag active volunteers without shifts, incomplete onboarding older than seven days, and onboarding older than thirty days. Private-field edits record field names only; county editing is staff-only.
- Refreshed the five quick-login personas for the three-status model: ready-to-activate and new onboarding accounts replace the former identities in place, with updated fake profile defaults and labels.
- Simplified volunteer workflow to Onboarding, Active and Inactive. Legacy enum values/data remain intact and read as Onboarding.
- Disabled in-app certification, background-check and agreement tracking by default; extra onboarding questions are empty. Training and paperwork are handled by Alliance staff.
- Private profile fields are available only to their owner and staff. Volunteer DOB/start-date changes are rejected.
### Fixed
- Volunteer schedule responses use the public team contact; legacy statuses normalize in `/api/me`; activation requires recorded onboarding completion; signup phones use ten digits; external jobs accept only X-Jobs-Secret.
- Readable CSV/job labels, the staff-only notes label and header county, Alliance Blue usage charts, and From/Reply-To in development email logs.
- Test-account reset now cancels one-time reservations without touching real volunteers' assignments.
- The `/api/me` renewal indicator respects the disabled agreement-tracking flag.
- Updated guard/privacy regression tests and isolated end-to-end smoke coverage for the fixed profile, blocks, one-time shifts, reminders and messaging.
- QA-suppressed email outcomes are accepted by workflow response contracts; ordinary QA preparation preserves saved profile progress and status.

### Deployment and branding
- Refreshed the Community Care Team identity, Resource Coordinator-facing copy, team contact guidance, Alliance Blue/Open Sans styling, approved static logos and home-screen icons, and branded email presentation. Workflows and data models are unchanged.
- Production schema changes are managed by Replit Publish only. Removed boot-time Drizzle migrations, migration-history guard and runner commands; configuration validation remains enabled.
- Deployment instructions no longer require migration-history baselining and describe the two existing CHECK-constraint differences that Publish previously omitted.

## v1.0.0 — Initial Alliance Volunteer Portal

### Added
- Alliance branding, accessible responsive public/admin/volunteer layouts, mobile tabs and home-screen manifest.
- Email/password signup, verification gate, secure Postgres sessions, password reset and role-based route protection.
- Administrator invitations, activation controls and first-admin setup command; optional Google OAuth integration requires provider configuration.
- Configurable onboarding questionnaire (copy still subject to client approval), agreement acknowledgment/version renewal, volunteer dashboard and editable profile.
- Searchable/filterable volunteer roster, needs-attention summaries, bulk-message selection and administrator-only roster/schedule CSV exports.
- Volunteer detail, eligibility-gated approval, certification/background-check status tracking, staff-only notes and activity history.
- Configurable weekly shift grid/capacity, closures, Pacific/DST-aware occurrences, coordinator On Shift Now/Up Next and master schedule views.
- Transactional volunteer shift signup/change/drop, weeks off/undo, eligibility and overlap checks; explicit administrator assignment overrides and removals.
- Coverage reduction alerts, optional weekday Pacific daily digest, scheduled reminders, external secret-authenticated trigger and jobs monitoring.
- Administrator messages/blasts, branded email copies, volunteer inbox, unread badges and per-recipient read receipts.
- Central Postmark-ready email service, deduplication, notification history/retries, monthly counts/usage alerts and six-month chart.
- Private PDF/DOCX resource storage/downloads, markdown knowledge base, quick links, publishing/reordering and agreement update controls.
- Public production readiness endpoint, fail-closed configuration checks and development/reference SQL migration files.
- Isolated Playwright lifecycle smoke script, automated route/privacy/security/DST checks, UAT checklist and deployment/rollback guide.

### Security
- Server-side verification/activity/role/ownership enforcement; volunteer endpoints exclude peer personal information and staff notes.
- Hashed single-use tokens, bcrypt passwords, request validation, CSRF/origin checks, auth/message rate limits and security headers.
- Private bounded/signature-checked uploads, safe filenames/ZIP structure checks, production error masking and development-only test endpoints.
- Production missing-provider failures do not expose recovery links; dummy seeding requires explicit development acknowledgment.
- Dependency patches applied; the remaining unpatched development-only `braces` finding is tracked in `QA-SECURITY-REVIEW.md`.

### Deployment notes
- Production uses Autoscale with the built-in scheduler disabled; cron-job.org triggers the secret-protected runner every 15 minutes.
- Production uses its own managed database; no production fixtures or real volunteer records are loaded by release setup.
- Replit Publish synchronizes the production schema; the app does not run migrations or require a baseline journal at startup.
- Alternative Autoscale + Scheduled Deployment procedure is in `DEPLOY.md`.
