# QA and security review

## Calendar capability URLs (v1.5.0)

The only deliberately public calendar resource is `GET` / `HEAD /api/calendar/{token}.ics`, declared public in the default-deny route policy and mounted before the browser CSRF guard. A 256-bit base64url capability is required; its SHA-256 hash is the lookup key and AES-256-GCM ciphertext is stored at rest with a key derived from SESSION_SECRET. Unknown/malformed links share a 404 body and a database lookup. Limits are 120 requests/hour per valid token and 30/hour per unknown-request IP, with Retry-After.

Only the owner's shifts are queried, using the existing occurrence service. No other volunteer's identity, assignment ID, private profile fields or staff notes are serialized. There are no attendees, organizers, invitations or app-set alarms. Inactive/deactivated/archived owners get an empty calendar. Owners can reset links with CSRF protection; a token-free activity entry records the reset. Staff see only connection time and a coarse calendar-client category, never a URL or token. Tokens are redacted from application request paths; response caching remains no-store. Possession of the link still permits viewing shift times: volunteers are explicitly told to keep it private. Reset QA accounts removes only those personas' feeds in the same transaction.

## Fixed findings

1. **Critical — recovery/invite links in production logs:** incomplete Postmark configuration previously fell back to logging complete emails in production. Production now fails closed, records a failed notification and returns a safe failure without logging the body or links. Development retains clickable email logging.
2. **High — unsafe seed environment:** an unset environment previously permitted known-password fixtures. Seed now requires exact development mode plus an explicit development-database acknowledgment, before database import or file writes.
3. **Route and privacy safeguards:** audited actual Express 5 registrations, including nested Google/auth routers. Removed catch-all method registrations; new/untracked routes fail the automated inventory check. Protected routes reject anonymous access; volunteer feeds are tested against peer identity/staff-note sentinels.
4. **Request hardening:** required matching Origin and session CSRF token on browser mutations, added database-backed staff/IP message-send limits, bounded/validated write bodies including no-payload actions, consistent error codes, and Helmet headers. Secret-authenticated job triggers remain an intentional non-browser exception.
5. **Private upload checks:** DOCX central-directory entries must match bounded local headers; duplicate entries and macro payloads are rejected. Existing signature, size, traversal, private-key and authenticated-download checks remain in place.
6. **Pacific time and production exclusions:** fixed browser-local activity/account/job timestamps; added spring/fall transition and UTC-midnight tests; coordinator clocks require explicit-zone timestamps and are development-only. Test-email APIs/buttons are disabled outside development, alongside the existing style-guide exclusion.
7. **Dependency updates:** patched proxy-addr, brace-expansion, fast-uri, source-map-js, postcss-selector-parser and uuid via scoped workspace overrides. Both frontend builds and backend integration checks are used to verify compatibility.

## Verification

- Workspace TypeScript checks pass.
- Portal and mockup-sandbox production builds pass; the API rebuilds and serves its health endpoint with the expected security headers.
- 92 Vitest checks pass across 14 suites: scheduling/DST, overrides, coverage, messaging, jobs, notifications, resources, guards and production exclusions.
- 21 authentication checks pass.
- 23 email/volunteer checks pass, including production no-log failure and cross-volunteer privacy.
- 14 roster/onboarding checks pass.
- Total: **150 passing automated checks**.
- Browser smoke verified signup, the actual logged verification link, onboarding, admin sign-in/approval, shift booking, logged reminder, message composition/send and the inbox read action. Its original final receipt assertion raced the asynchronous read request; the script now waits for that response before checking persistence.
- Smoke uses a temporary schema and separate API with no copied users or real email delivery. Setup/cleanup failures were checked for leftover schemas; no existing app records were changed.
- Manual UAT steps for every workflow are in **QA-CHECKLIST.md**. This review is not a penetration-test certification or a formal accessibility conformance claim.

## Remaining dependency finding

**High: braces 3.0.3 — deeply nested glob patterns can exhaust the stack.**

The final dependency scan reports this one remaining finding, with no published upstream fix.
It is brought in only by `fast-glob → micromatch` in the mockup sandbox's development tooling.
The plugin uses a fixed source-file discovery pattern; the portal API does not import it or accept user-supplied glob patterns.
Do not add untrusted pattern inputs. Update/remove that development dependency when a compatible fix is available.
This is documented rather than hidden or suppressed.

## Static-scan classifications

- The fixed bcrypt dummy hash is for timing equalization on nonexistent accounts, not an account password or provider secret.
- Seed-support SHA-1 creates deterministic UUIDv5 fixture identifiers, not authentication tokens or password hashes. Changing it would break repeatable fixture identity.
- The privacy/dataflow scan reported no findings. Authentication tokens continue to use random 32-byte values and stored SHA-256 hashes.

## Operating notes

Production needs both provider token and sender address for email delivery. Do not assume a successful console log means mail was delivered in production.
Use one authorized scheduler strategy; keep test-clock overrides and full email logging development-only.
Do not run reminder or broadcast QA against shared operational users. Follow the isolated smoke command in the checklist.
