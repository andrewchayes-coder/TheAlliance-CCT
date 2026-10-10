# Changelog

User-facing releases and migration/operating changes are recorded here. Add new releases above older entries with Added / Changed / Fixed / Security sections as applicable.

## Unreleased

### Changed
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
- Reserved VM with one scheduler and `RUN_JOBS=true` is the recommended configuration.
- Production uses its own managed database; no production fixtures or real volunteer records are loaded by release setup.
- Replit Publish synchronizes the production schema; the app does not run migrations or require a baseline journal at startup.
- Alternative Autoscale + Scheduled Deployment procedure is in `DEPLOY.md`.
