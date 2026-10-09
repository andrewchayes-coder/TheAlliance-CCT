# Alliance Volunteer Portal — production deployment

## Safety rules

- Production uses **Replit's separate production PostgreSQL database**. The workspace `DATABASE_URL` is development; the deployment's managed `DATABASE_URL` is production. Never copy credentials into source or manually replace these managed values.
- Do **not copy development data** when provisioning production. Development contains dummy identities/fixtures. Do not load real volunteer data during setup.
- Never run `seed`, `verify-seed`, resource-seed migration utilities, `db push`, or `push-force` in production. The seed script refuses any environment except explicitly acknowledged development.
- Versioned SQL lives in `lib/db/migrations`. Generate/review/commit migrations in development with `pnpm db:generate`; `drizzle-kit migrate` applies them in production. Never edit an already-applied migration.
- Runtime startup is: validate configuration → acquire database migration lock → `drizzle-kit migrate` → start API/scheduler. Any failure stops the API. Migrations are **not** executed at build time, where the database context can differ.
- Development tables are not proof that production is provisioned. Select the **production** environment in Replit's Database/Publishing tools and review the schema/data-copy choices before publishing.

## Required production configuration

Use **Publishing → production environment variables/secrets**, not chat or source files.
The API fails loudly with **key names only** if configuration is missing/invalid.

| Key | Required value / purpose |
|---|---|
| `NODE_ENV` | `production` (set in artifact runtime configuration). |
| `SESSION_SECRET` | Secret: securely generated, at least 32 characters. Keep stable across restarts; rotating invalidates sessions and affects encrypted retry payloads. |
| `APP_BASE_URL` | HTTPS origin of the published app, no path/query/credentials. Used for email links, redirects and CSRF. |
| `POSTMARK_SERVER_TOKEN` | Secret: Postmark server token for the production server. |
| `EMAIL_FROM` | Bare email address verified with Postmark; no display-name wrapper. |
| `JOBS_SECRET` | Secret: securely generated, at least 32 characters. External trigger sends it in `X-Jobs-Secret`. |
| `RUN_JOBS` | Required literal `true` on Reserved VM; `false` for external scheduling. No implicit default in production. |
| `DATABASE_URL` | Managed automatically by Replit; must point to the separate production DB at runtime. Do not set manually. |

`APP_ORIGIN` is a legacy alias. If retained, it must match `APP_BASE_URL`; change both together for a custom domain. Development can continue to use `APP_ORIGIN` or the managed dev domain.

For documents, retain Replit's configured private Object Storage bucket/environment (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, and applicable public search paths). Never expose private document URLs or replace the storage SDK configuration with a local upload directory.
Optional Google OAuth credentials/callback configuration are separate from this checklist; don't enable it before provider setup is complete.

Postmark must have a verified sender/domain and the `outbound` message stream. Production does **not** log email bodies/verification links when provider configuration is incomplete; delivery fails and the failure is recorded.

## Database migration preparation

At preparation, read-only production metadata confirmed Alliance tables already exist **without** a migration journal. Follow the existing-database procedure below before republishing. The production Postmark token also still needs secure configuration; saving deployment settings does not update the running release.

### Fresh production database

1. Provision a distinct production database through Publishing; decline development **data** copying.
2. Ensure the schema is empty before the initial SQL migration. Review any automatic schema synchronization presented by Publishing; use this project's versioned migration path, not push.
3. Publishing builds the API/frontend, then the production launcher runs migrations against the runtime production connection. The committed initial migration creates tables/enums/constraints, but inserts **no volunteers, administrators, resources or schedules**.
4. Confirm `/api/health` and the migration journal `drizzle.__drizzle_migrations` using production metadata/SQL tools.

### Already-published database created with push or schema copying

This project previously used push and may already have production tables. The new migrator deliberately refuses to replay the initial migration on existing Alliance tables without a journal.

**Stop before republishing that database.** Back it up, inspect its schema (including named CHECK constraints), and reconcile it with the committed initial SQL/snapshot. An operator must review and baseline migration history only after exact schema agreement; do not blindly mark the initial migration applied. If there are differences, prepare an explicit reviewed migration plan. Do not delete tables, reseed, or copy development rows to make the error disappear.

This preparation does not inspect or change production volunteer rows, apply production DDL, or baseline an existing production DB.

## First-time setup (no volunteer data)

1. Configure required production keys and the separate database. Select **Reserved VM** in Publishing; keep one scheduler-bearing API instance and `RUN_JOBS=true`. The saved target is Reserved VM; compute size is selected in Publishing.
2. Review migration SQL and confirm baseline requirements above. Publish using the user-controlled Publish action.
3. Visit `/api/health`: expected HTTP 200 with `status=ok`, `db=ok`, `email.configured=true`. This checks connectivity/configuration, **not** Postmark token validity or mailbox delivery. `/api/healthz` remains a minimal compatibility liveness endpoint.
4. Create the first administrator from an **operator shell explicitly configured for the production database**, never the ordinary workspace Shell:
   ```sh
   NODE_ENV=production npm run create-admin -- email@domain.org "First" "Last"
   ```
   Use the managed production connection via Replit's secure environment tooling. This command prints an invite link for the named administrator. Treat it as a one-time credential; don't paste it into logs/tickets. Accept the invite, set a strong password, then sign in. No dummy admin is created by migrations.
5. `/admin/schedule/settings`: configure Mon–Fri slots, times/capacity, copy Monday if appropriate, and add closure dates. Confirm Pacific operating hours.
6. `/admin/resources`: upload and publish the actual User Agreement and Safety Guidelines under **Agreements** (PDF/DOCX, up to 15 MB). Review `agreementVersion`; use the re-acknowledgment option when agreement content changes. Delete/replace placeholder links, not operational data.
7. Create and publish quick links for **Log in to Find Help** and **Open Phone Portal**, with their real HTTPS URLs (there are no seeded resources in production). Test both in a new tab. Review the configured Alliance contact details and finalize questionnaire copy before real onboarding.
8. `/admin/notifications`: set the Postmark monthly limit (default 100); decide whether to enable the daily coverage digest in schedule settings.
9. Test actual delivery **to the verified administrator only**, using the production-configured operator shell:
   ```sh
   NODE_ENV=production PRODUCTION_DATABASE_ACK=production npm run production-check -- email email@domain.org
   NODE_ENV=production PRODUCTION_DATABASE_ACK=production npm run production-check -- reminder email@domain.org
   ```
   Both use the single email service and create notification rows. The reminder is a synthetic tomorrow 9–11 AM message to that administrator, not an assignment/reminder to volunteers. Confirm messages arrive and notification statuses are **sent**, not logged/failed.
   Development-only HTTP test-email/reminder routes stay disabled in production.
10. `/admin/notifications/jobs`: check scheduler enabled, last-run status, and use the normal **Run reminder check now** action when appropriate. With no volunteers/assignments, no volunteer reminders should be produced. Confirm the enabled digest settings separately.
11. Complete `QA-CHECKLIST.md` using isolated QA data outside production. Only begin real volunteer onboarding after the owner approves UAT.

The deployment configuration does not publish automatically. Changing saved target/settings does not change the currently running deployment until a new publish.

## Scheduling

### Recommended: Reserved VM

Always-on runtime, `RUN_JOBS=true`. Node-cron checks reminders every 15 minutes with `America/Los_Angeles`; the daily coverage digest runs at 7 AM Pacific on weekdays with restart catch-up and durable deduplication. Do not run a second external scheduler at the same time.

### Alternative: Autoscale + Scheduled Deployment

1. Switch the portal target to Autoscale and set its production `RUN_JOBS=false`, so scaled instances don't each schedule jobs.
2. Configure a separate Replit Scheduled Deployment to run every 15 minutes (`*/15 * * * *`). Its command is:
   ```sh
   pnpm --filter @workspace/api-server run reminder-trigger
   ```
3. In the scheduled runtime securely configure `JOBS_SECRET` to match the portal and set `JOBS_RUN_URL` to the **published** origin plus `/api/jobs/run`. Do not use `.replit.dev`, send secrets as query parameters, or put them in cron command text.
4. The trigger sends HTTPS POST `{}` with `X-Jobs-Secret`; non-2xx responses fail the scheduled run. Verify scheduled-run logs and the admin jobs page.
5. The endpoint runs reminders and the due weekday coverage digest. The daily digest's Pacific-clock gate and durable date dedupe prevent duplicate sends; running every 15 minutes also handles DST.
6. If Publishing privacy gates external access, configure a production external-access token as required by Replit. The supplied trigger targets the current **public** deployment; private access needs an additional securely managed bearer header before switching privacy.

Deployment privacy, scheduled deployment availability, timezone/cron and resource settings must be confirmed in Publishing. Scheduled runs do not need database access; they call the portal API.

## Custom domain

1. Publishing → Domains → connect your domain. Add the exact DNS records Replit provides at your DNS provider; don't guess A/CNAME values. Wait for DNS verification and TLS.
2. Set production `APP_BASE_URL` to `https://your-domain` and update/remove legacy `APP_ORIGIN` so it matches. Update `JOBS_RUN_URL` in any external scheduler.
3. Republish/restart with the new environment. Recheck sign-in/CSRF, invite/verification/reset email links, private downloads and scheduled triggers.
4. If Google OAuth is enabled later, register the new exact HTTPS callback URL with the provider. Existing sessions on the old domain won't transfer to the new one.

## Health and monitoring

`GET /api/health` is explicitly public: only database readiness and a boolean email-configuration status. No sender address, provider token, connection string, credentials, user data or error stack is returned. HTTP 503 indicates degraded readiness; checks have a bounded wait and shared short cache.

Monitor Publishing runtime logs, notification failures/monthly usage, jobs last-run history, coverage/digest settings and Postmark delivery/bounces. Never share bearer links or secret headers in tickets.

## Rollback

1. Pause background scheduling (`RUN_JOBS=false`) if the faulty release could send incorrect mail. Preserve the environment and production DB; don't run seed/push.
2. Review Publishing history for a previous successful release where available, or restore a known-good **code checkpoint** and publish that code again. Save current diagnostic details first.
3. A code rollback does **not** reverse applied SQL migrations or sent email. Prefer backward-compatible additive migrations and forward fixes. Do not edit migration journal rows or applied SQL files.
4. If restoring production data is necessary, use an operator-approved production backup/PITR recovery plan in Replit's production database tooling. Workspace/development checkpoints are not a substitute for production recovery; confirm which environment a restore affects before approving it.
5. Recheck health, administrator sign-in, resources, schedule rendering and jobs. Re-enable exactly one scheduler after confirming correct data/time behavior.

## Release procedure

Review `CHANGELOG.md`, migrations, production key presence and UAT results; publish; check readiness/delivery/jobs; retain a rollback plan. Avoid destructive schema changes in the same release that first uses a field/table.

References: [Databases](https://docs.replit.com/features/data-and-storage/development-and-production), [Deployment types](https://docs.replit.com/features/publishing/deployment-types), [Custom domains](https://docs.replit.com/features/publishing/custom-domains).
