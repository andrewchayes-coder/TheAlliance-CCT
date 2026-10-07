# Alliance Volunteer Portal

A mobile-first volunteer management portal for The Alliance's Resource Coordination Program.

## Current scope

The brand foundation, full database model, development seed, shared Postmark-ready email service, and custom email/password authentication are implemented. Google OAuth is prepared but unavailable until its client credentials are configured. Full onboarding forms, approvals, scheduling, messaging, resource hub, and administrative data screens are not implemented. The protected account/onboarding pages are real identity checkpoints, not full dashboards. UI navigation samples on the style guide remain labelled previews.

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
- A held/active assignment has an active slot and no end date before today. Future-start reservations count as held; end dates are inclusive. Rosters include all volunteer-profile statuses and account activation states; inactive profiles with assignments remain visible to staff.
- Both CSV downloads are generated server-side and require an active, verified admin session. Exports respect current filters but ignore pagination and bulk selection. The roster includes every profile field, raw answer JSON (preserving legacy answers), one column per configured question, contact/verification/login metadata, and formatted held shifts. It includes internal admin notes: share only with authorized staff. Authentication secrets/hashes are never exported.
- The schedule CSV has one row per held assignment, local weekday/time, start/end dates, and sorted future skip dates within that assignment's date range. All CSV cells are quoted/escaped and formula-neutralized; files use UTF-8 BOM and dated download filenames.
- Bulk selection retains volunteer user IDs across pages and clears on filter changes. “Message selected” calls the messaging hook and shows an explicit coming-later notice; no messages are sent in this step.
- Validation: `pnpm --filter @workspace/api-server run test:roster`, with owned, development-only fixtures and cleanup.

## Optional brand assets

Place the logo at `artifacts/alliance-volunteer-portal/public/brand/logo.svg` and the licensed Lulo Clean font at `artifacts/alliance-volunteer-portal/public/fonts/LuloClean.woff2`. Restart the frontend workflow after adding either asset.

Absent assets use the display-font wordmark and Montserrat 800. Open Sans 400/600/700 and Montserrat 800 load from Google Fonts. Do not invent a replacement logo.
