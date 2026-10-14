# Community Care Team Volunteer Portal — production deployment

## If dummy data ever appears in production

Pause cron-job.org and follow [the seed-data cleanup runbook](docs/ops/2026-10-11-purge-seed-data.md).
Run its pre-checks first, preserve the five QA identities and the shift grid, and execute its independent SQL statements
yourself in the Production Database tool. Do not run a seed script or copy development data to production to fix it.

## Account profiles update

Publish applies two additive nullable columns: `users.profile_photo_key` and `auth_tokens.pending_email`.
The reference SQL is `lib/db/migrations/0004_account_profiles.sql`; do not run it at startup or against production.
No production data backfill is needed.

Profile photos use the existing private Object Storage bucket, not public asset URLs. PNG/JPEG/WebP input is limited
to 3 MB and converted to a metadata-free, maximum 512×512 PNG. Staff and owners access photos through authenticated API routes.

Before release, check My Profile as both roles, name/phone persistence, photo upload/removal, verified email change,
password change/session logout, and Team/volunteer account editing plus reset links. Test-account emails remain suppressed;
test administrators can only write to test accounts through these new controls. For real-user UAT, leave public quick login off.

Email changes retain the current verified address until the new address is confirmed. Reset links go to the current
verified address; staff never see or set a team member’s password. Disabled/unverified accounts must be activated/verified first.

## Fixed profile / three-status release

Before Publish, an authorized operator must add the enum value in the production Database tool as a separate committed statement:

```sql
ALTER TYPE volunteer_status ADD VALUE IF NOT EXISTS 'onboarding';
```

Publish cannot add and use a new enum value in the same transaction. Publish manages the remaining additive update: change the existing status default and add the nine nullable profile columns (state defaults to CA). Review that diff before publishing. The reference migration is `lib/db/migrations/0002_cct_fixed_profile.sql`; do not run it at boot or restore a migration hook. This documentation change does not execute SQL or modify production data.

Publish does not perform application data backfills. After the new enum value is available, the optional legacy-status backfill is one short statement:

```sql
UPDATE public.volunteer_profiles SET status = 'onboarding' WHERE status::text NOT IN ('onboarding', 'active', 'inactive');
```

This has been applied in development only. No production data was changed for this release. Reads are compatible without running it; the deprecated enum values and legacy columns remain intact. Do not invent DOB/address/emergency-contact values for real volunteers: they complete the new profile themselves. Existing completed profiles missing required fields return to onboarding.

New activation requires verified email, recorded onboarding completion and all required fixed-profile fields, not the disabled certification/background/agreement checks. First activation supplies today's Pacific start date if absent; staff can edit it. Onboarding questions are empty and the three tracking flags are false in `shared/appConfig.ts`. Training and paperwork take place with Alliance staff outside the portal.

Approved logos/icons ship with the web build at `/brand/`. That public path is served by the API artifact's static-file handler with `Cache-Control: public, max-age=31536000, immutable`, before sessions; it never reads Object Storage at runtime. Email headers use `${APP_BASE_URL}/brand/logo-horizontal.png`. Replace assets with versioned filenames/URLs if the artwork changes later, rather than expecting a year-cached URL to refresh immediately.

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
| `POSTMARK_SERVER_TOKEN` | Secret: server token from the separate Postmark server dedicated to this CCT app, not an account token or another app's server token. |
| `EMAIL_FROM` | Secret: exactly `The Alliance Community Care Team <cct@defendingthecause.org>`. Display name plus address is required; malformed sender configuration stops startup without printing values. |
| `EMAIL_REPLY_TO` | Optional secret: a single public team email address. If omitted/blank, replies go to the parsed `EMAIL_FROM` address (`cct@defendingthecause.org`). Never configure a named staff member's private mailbox. |
| `JOBS_SECRET` | Secret: securely generated, at least 32 characters. External trigger sends it in `X-Jobs-Secret`. |
| `RUN_JOBS` | Required literal `false` in production. Production automatic timers are disabled; cron-job.org invokes the external endpoint. Development may use `true` for timer testing. |
| `DATABASE_URL` | Managed automatically by Replit; must point to the separate production DB at runtime. Do not set manually. |

### Profile and staff-record configuration

- `autoActivateOnProfileComplete: true`: a verified Onboarding volunteer becomes Active in the profile-completion transaction; one welcome email links to Shifts. Turning this off retains manual activation and the original welcome copy.
- `trackBackgroundCheckAdminOnly: true`: staff-only completion checkbox/date, roster filter and optional column, and CSV completion/date columns. Never an activation or shift gate. The old `trackBackgroundCheckInApp` stays false.
- `minimumAge: 18`: required for volunteer onboarding and staff DOB edits; the eighteenth birthday counts using Pacific dates.

### Dedicated Postmark server and domain
Use a separate Postmark server for this app and its `outbound` transactional stream. Add the `defendingthecause.org` sending domain in Postmark, install the exact DKIM and Return-Path DNS records provided there, and confirm both show **Verified** before sending. DNS verification and inbox delivery cannot be inferred from the token-configured indicator. Do not paste tokens into chat or documentation.

The sender display name/address and effective Reply-To appear on `/admin/notifications`; volunteers do not receive staff mailbox addresses through message context or automatic headers. Development without a token retains log-only delivery. Production retains required-secret checks and does not log private recovery emails when delivery configuration is missing. Update secure development/production configuration and publish the updated release before live use.

Previously saved failed emails with a retired branded footer are not replayed: create a fresh message/reminder using the current team contact. Authentication-email retries still regenerate links and current templates. Existing notification history is retained unchanged.

### Quick login (testing)

1. Set `QUICK_LOGIN_ENABLED=true` and republish to enable production testing. Matching is case-insensitive and trims whitespace. No other testing credential is required. Development is always enabled.
2. Anyone visiting `/signin` can use the five TEST buttons. **The Admin test button opens the real admin view.** Only synthetic personas are eligible; ordinary users are never converted or imported from development.
3. QA mail is suppressed and excluded from usage, broadcasts, digest recipients, normal roster/counts and exports. TEST badges identify reservations, which intentionally use real capacity.
4. After production testing, click **Reset test accounts**. This frees QA standing capacity, cancels QA one-time reservations, restores profiles/inboxes and invalidates QA sessions, without removing real volunteer assignments. Production reset does not automatically take a shift.
5. Set `QUICK_LOGIN_ENABLED=false` and republish **before inviting real volunteers**. The card disappears and both quick-login endpoints return 404. Normal sign-in remains available.

### v1.1.0 schedule setup

In `/admin/schedule/settings`, use **Load standard grid** to create 40 overlapping weekday slots: two-hour windows starting hourly from 9 AM through 4 PM, capacity two, ending by 6 PM. Repeat loading is safe and preserves existing edits/assignments.
Use **Blocked shifts** for selected slots or all slots on specific dates/ranges, with a reason and optional volunteer notice. A block suppresses occurrences, reminders and coverage checks but retains standing assignments; unblock when availability returns.
Use **One-time shifts** from the master schedule controls for dated extra coverage. Choose whether volunteers can claim seats; staff overrides require explicit consent and a reason. These reservations do not consume the standing-shift cap and appear in dispatch, reminders and schedule CSV.
Check test-account indicators on custom reservations. Cancelling a one-time shift releases its seats; closing a whole date suppresses all standing and one-time occurrences.

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

For the operator-approved CHECK corrections, first run this read-only capacity check and resolve any invalid rows without silently changing data:

```sql
SELECT id, capacity FROM public.shift_slots WHERE capacity NOT BETWEEN 1 AND 10;
```

If there are no invalid capacities and Publish still omits the corrections, an authorized operator may run each of these as a separate one-line statement. These replace constraint definitions only; they do not rewrite volunteer records:

```sql
ALTER TABLE public.shift_slots DROP CONSTRAINT IF EXISTS shift_slots_capacity_positive, ADD CONSTRAINT shift_slots_capacity_positive CHECK (capacity BETWEEN 1 AND 10);
ALTER TABLE public.shift_assignments DROP CONSTRAINT IF EXISTS shift_assignments_date_order, ADD CONSTRAINT shift_assignments_date_order CHECK (end_date IS NULL OR end_date >= start_date OR ended_reason IS NOT NULL);
```

## First-time setup (no volunteer data)

1. Configure required production keys and the separate database. Keep **Autoscale** in Publishing and set production `RUN_JOBS=false`. Configure cron-job.org after publishing the new release.
2. Review Publishing's schema diff and the CHECK-constraint caveat above. Publish using the user-controlled Publish action; no Drizzle baseline is needed.
3. Visit `/api/health`: expected HTTP 200 with `status=ok`, `db=ok`, `email.configured=true`. This checks connectivity/configuration, **not** Postmark token validity or mailbox delivery. `/api/healthz` remains a minimal compatibility liveness endpoint.
4. Create the first administrator from an **operator shell explicitly configured for the production database**, never the ordinary workspace Shell:
   ```sh
   NODE_ENV=production npm run create-admin -- email@domain.org "First" "Last"
   ```
    Use the managed production connection via Replit's secure environment tooling. This command prints an invite link for the named administrator. Treat it as a one-time credential; don't paste it into logs/tickets. Accept the invite, set a strong password, then sign in. No dummy admin is created at boot or by schema synchronization.
5. `/admin/schedule/settings`: click **Load Community Care Team standard grid**, then review the 40 Mon–Fri overlapping two-hour slots and capacity 2. Configure closed dates and date-specific blocks as needed. Repeating the loader creates no duplicates.
6. `/admin/resources`: upload and publish operational guides (PDF/DOCX, up to 15 MB). Training and paperwork are handled with staff outside the portal; no in-app compliance setup is required.
7. Create and publish quick links for **Log in to Find Help** and **Open Phone Portal**, with their real HTTPS URLs (there are no seeded resources in production). Test both in a new tab and review the Community Care Team contact guidance.
8. `/admin/notifications`: set the Postmark monthly limit (default 100); decide whether to enable the daily coverage digest in schedule settings.
9. Test actual delivery **to the signed-in verified administrator only**. In production, open **Admin → Notifications** and click **Send test email to me**. On **Reminder jobs**, click **Send test reminder to me**. Both admin-only actions keep the recipient fixed to your own account and require the normal session/CSRF protections. TEST accounts are suppressed, so use a normal admin to verify inbox delivery.
   Alternatively, use the production-configured operator shell:
   ```sh
   NODE_ENV=production PRODUCTION_DATABASE_ACK=production npm run production-check -- email email@domain.org
   NODE_ENV=production PRODUCTION_DATABASE_ACK=production npm run production-check -- reminder email@domain.org
   ```
   Both use the single email service and create notification rows. The reminder is a synthetic tomorrow 9–11 AM message to that administrator, not an assignment/reminder to volunteers. Confirm messages arrive and notification statuses are **sent**, not logged/failed.
   The legacy `/api/dev/email-test` route remains disabled in production. The two admin test-send routes above are available in production.
10. `/admin/notifications/jobs`: check that the status notice reads **Scheduled runs are on time** and the **Scheduler** row reads **cron-job.org (outside service), every 15 minutes**. Use **Run reminder check now** when appropriate; this runs the reminder step only, not the coverage email. With no volunteers/assignments, no volunteer reminders should be produced. Confirm the enabled digest settings separately.
11. Complete `QA-CHECKLIST.md` using isolated QA data outside production. Only begin real volunteer onboarding after the owner approves UAT.

The deployment configuration does not publish automatically. Changing saved target/settings does not change the currently running deployment until a new publish.

## Scheduling

### Autoscale + cron-job.org

Keep production `RUN_JOBS=false`. Both automatic reminder and coverage-digest timers are disabled in production, even if that flag accidentally becomes true. Development timers require `RUN_JOBS=true`.

The Reminder jobs page warns when no scheduled run has happened in **20 minutes**, or when the most recent scheduled run failed. Manual checks do not reset this scheduled-run health notice. If no scheduled run has ever been recorded, the page warns **No scheduled run has been recorded yet**.

Create one enabled cron-job.org job:

| Setting | Value |
|---|---|
| URL | `https://cct.defendingthecause.org/api/jobs/run` |
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
2. Set production `APP_BASE_URL` to `https://your-domain` and update/remove legacy `APP_ORIGIN` so it matches. Update `JOBS_RUN_URL` in any external scheduler. `APP_BASE_URL` determines the official address; the production portal forwards visitors on the old `.replit.app` address to it, preserving the path, query and fragment before rendering. Development and server-side health checks are never redirected.
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
