# Alliance Volunteer Portal — production deployment

## Safety rules

- Production uses **Replit's separate production PostgreSQL database**. The workspace `DATABASE_URL` is development; the deployment's managed `DATABASE_URL` is production. Never copy credentials into source or manually replace these managed values.
- Do **not copy development data** when provisioning production. Development contains dummy identities/fixtures. Do not load real volunteer data during setup.
- Never run `seed`, `verify-seed`, resource-seed migration utilities, `db push`, or `push-force` in production. The seed script refuses any environment except explicitly acknowledged development.
- **Replit Publish owns production schema changes**, using its development-to-production database diff. SQL files in `lib/db/migrations` are development/reference artifacts; the app does not execute them in production.
- Runtime startup is: validate configuration → start API/scheduler. There are no boot-time migrations, schema mutations, migration locks or missing-journal guards. Configuration failures still stop the API.
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
| `RUN_JOBS` | Required literal `false` in production. Production automatic timers are disabled; cron-job.org invokes the external endpoint. Development may use `true` for timer testing. |
| `DATABASE_URL` | Managed automatically by Replit; must point to the separate production DB at runtime. Do not set manually. |

`APP_ORIGIN` is a legacy alias. If retained, it must match `APP_BASE_URL`; change both together for a custom domain. Development can continue to use `APP_ORIGIN` or the managed dev domain.

For documents, retain Replit's configured private Object Storage bucket/environment (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, and applicable public search paths). Never expose private document URLs or replace the storage SDK configuration with a local upload directory.
Optional Google OAuth credentials/callback configuration are separate from this checklist; don't enable it before provider setup is complete.

Postmark must have a verified sender/domain and the `outbound` message stream. Production does **not** log email bodies/verification links when provider configuration is incomplete; delivery fails and the failure is recorded.

## Database schema preparation

Review Publishing's proposed development-to-production schema diff before publishing. Decline data-copy/overwrite options. A Drizzle migration journal or baseline is **not required** for app startup or Replit-managed schema synchronization. The production Postmark settings still need secure configuration; saving deployment settings does not update the running release.

### Fresh production database

1. Provision a distinct production database through Publishing; decline development **data** copying.
2. Review the schema synchronization presented by Publishing; Publish provisions the schema from development without requiring copied development rows.
3. Publishing builds the API/frontend and applies its schema diff. The production launcher validates configuration and starts the API; it never runs Drizzle migrations or seed scripts.
4. Confirm `/api/health` and the resulting production schema using read-only production metadata tools.

### Existing production database and CHECK constraints

Preserve existing data and review Publish's proposed SQL. Do not replay the initial migration, create a baseline journal, delete tables, reseed or copy development rows.

The read-only comparison found two older production CHECK definitions even though development already has the intended definitions:

| Constraint | Production | Intended development definition |
|---|---|---|
| `shift_slots_capacity_positive` | `capacity > 0` | `capacity BETWEEN 1 AND 10` |
| `shift_assignments_date_order` | `end_date IS NULL OR end_date >= start_date` | Also permits `ended_reason IS NOT NULL` |

The inspected Publish log applied other schema changes but omitted replacements for both existing CHECK constraints. Therefore another Publish cannot be assumed to repair them merely because their names match. Review the proposed SQL for explicit constraint replacements and verify their definitions afterward using read-only metadata. If they are still omitted, an explicit operator-reviewed correction is needed through the database administration process; do not add startup DDL as a workaround. Before tightening capacity, check for existing values outside 1–10 and agree on any required remediation; never silently change those rows.

No production schema or records were modified by this launcher cleanup.

## First-time setup (no volunteer data)

1. Configure required production keys and the separate database. Keep **Autoscale** in Publishing and set production `RUN_JOBS=false`. Configure cron-job.org after publishing the new release.
2. Review Publishing's schema diff and the CHECK-constraint caveat above. Publish using the user-controlled Publish action; no Drizzle baseline is needed.
3. Visit `/api/health`: expected HTTP 200 with `status=ok`, `db=ok`, `email.configured=true`. This checks connectivity/configuration, **not** Postmark token validity or mailbox delivery. `/api/healthz` remains a minimal compatibility liveness endpoint.
4. Create the first administrator from an **operator shell explicitly configured for the production database**, never the ordinary workspace Shell:
   ```sh
   NODE_ENV=production npm run create-admin -- email@domain.org "First" "Last"
   ```
    Use the managed production connection via Replit's secure environment tooling. This command prints an invite link for the named administrator. Treat it as a one-time credential; don't paste it into logs/tickets. Accept the invite, set a strong password, then sign in. No dummy admin is created at boot or by schema synchronization.
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

### Autoscale + cron-job.org

Keep production `RUN_JOBS=false`. Both automatic reminder and coverage-digest timers are disabled in production, even if that flag accidentally becomes true. Development timers require `RUN_JOBS=true`.

Create one enabled cron-job.org job:

| Setting | Value |
|---|---|
| URL | `https://the-alliance-cct.replit.app/api/jobs/run` |
| Method | `POST` |
| Header | `X-Jobs-Secret`: the existing production `JOBS_SECRET` value, entered securely in cron-job.org |
| Header | `Content-Type`: `application/json` |
| Request body | `{}` |
| Schedule | Every 15 minutes, all hours, every day (`*/15 * * * *`; minutes `0,15,30,45`) |
| Timezone | `America/Los_Angeles` |
| Execution timeout | 30 seconds |
| Notifications | Enable failure/recovery notifications; do not rely on automatic retries |

Publish this release before enabling the external job. Never put the token in a query string, source control, or log. The current deployment is public; if publishing privacy changes, an additional Replit external-access credential may be required.

The shared application budget is approximately 20 seconds, excluding cold start/network latency. Job-only database waits and Postmark calls are bounded. All started work settles before responding; no background continuation or new queue/table is used. The JSON response contains `elapsedMs`, `budgetMs`, `incomplete`, and reminder counts. An incomplete 200 response means the next 15-minute invocation must continue; persistent errors or insufficient throughput require staff attention in execution history and `/admin/notifications/jobs`.

Catch-up reevaluates due reminders from their 24-hour deadline until the shift starts. Enabled morning reminders catch up from their configured Pacific hour until shift start. Week-offs, closures, inactive/unverified volunteers and ended assignments remain excluded. Confirmed `sent`/`logged` recipients are filtered before batching, so they cannot starve unfinished recipients. Digest catch-up is for the current Pacific weekday after 7 AM, not stale past dates. Monthly usage alerts also share the budget.

Uncertain delivery is recorded as `failed` with a `DELIVERY_UNCERTAIN:` error in the existing notification log. The admin log shows **Delivery uncertain** and disables Retry; review Postmark rather than resending. Old interrupted-delivery markers receive the same protection. Explicit provider rejections remain retryable. Confirmed provider acceptance followed by audit failure is never resent.

The supplied `reminder-trigger` command remains available for an operator or a Replit Scheduled Deployment as an alternative caller. Do not enable two external schedulers. Scheduled callers need only HTTPS access and the secret, not database access.

## Custom domain

1. Publishing → Domains → connect your domain. Add the exact DNS records Replit provides at your DNS provider; don't guess A/CNAME values. Wait for DNS verification and TLS.
2. Set production `APP_BASE_URL` to `https://your-domain` and update/remove legacy `APP_ORIGIN` so it matches. Update `JOBS_RUN_URL` in any external scheduler.
3. Republish/restart with the new environment. Recheck sign-in/CSRF, invite/verification/reset email links, private downloads and scheduled triggers.
4. If Google OAuth is enabled later, register the new exact HTTPS callback URL with the provider. Existing sessions on the old domain won't transfer to the new one.

## Health and monitoring

`GET /api/health` is explicitly public: only database readiness and a boolean email-configuration status. No sender address, provider token, connection string, credentials, user data or error stack is returned. HTTP 503 indicates degraded readiness; checks have a bounded wait and shared short cache.

Monitor Publishing runtime logs, notification failures/monthly usage, jobs last-run history, coverage/digest settings and Postmark delivery/bounces. Never share bearer links or secret headers in tickets.

## Rollback

1. Disable the cron-job.org job if the faulty release could send incorrect mail; `RUN_JOBS=false` does not disable authorized external requests. Preserve the environment and production DB; don't run seed/push.
2. Review Publishing history for a previous successful release where available, or restore a known-good **code checkpoint** and publish that code again. Save current diagnostic details first.
3. A code rollback does **not** reverse schema changes applied by Publish or sent email. Review the proposed schema diff when republishing older code, prefer backward-compatible changes and do not assume a schema rollback preserves data.
4. If restoring production data is necessary, use an operator-approved production backup/PITR recovery plan in Replit's production database tooling. Workspace/development checkpoints are not a substitute for production recovery; confirm which environment a restore affects before approving it.
5. Recheck health, administrator sign-in, resources, schedule rendering and jobs. Re-enable exactly one scheduler after confirming correct data/time behavior.

## Release procedure

Review `CHANGELOG.md`, Publishing's proposed schema diff, production key presence and UAT results; publish; check readiness/delivery/jobs; retain a rollback plan. Avoid destructive schema changes in the same release that first uses a field/table.

References: [Databases](https://docs.replit.com/features/data-and-storage/development-and-production), [Deployment types](https://docs.replit.com/features/publishing/deployment-types), [Custom domains](https://docs.replit.com/features/publishing/custom-domains).
