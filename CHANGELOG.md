# Changelog

User-facing releases and migration/operating changes are recorded here. Add new releases above older entries with Added / Changed / Fixed / Security sections as applicable.

## v1.1.1 — 2026-10-11

### Fixed
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
