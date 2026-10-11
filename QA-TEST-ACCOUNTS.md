# Built-in QA accounts

The five personas in `shared/testAccounts.ts` are created by app code at startup
when quick login is enabled. Development enables them automatically; production
requires `QUICK_LOGIN_ENABLED=true` and a `QUICK_LOGIN_KEY` of at least 32 characters. No password or quick-login key is returned,
stored in the persona config, or displayed. Password and Google sign-in cannot
be used to access these accounts.

## Quick-login production lock

Open `/qa?key=<your QUICK_LOGIN_KEY>` over HTTPS to unlock this browser, then
use the sign-in screen. The endpoint never echoes the key and request logs omit
query strings. It sets the signed `qa_unlock` cookie for 30 days with HttpOnly,
Secure, and SameSite=Lax. Rotating either signing secret invalidates the unlock.
Use `/qa/lock` to clear the unlock cookie and return to sign-in; this does not
end an already-established sign-in session.

`GET /api/auth/quick-login/status` returns only persona keys, labels, roles, and
descriptions. Locked or disabled production requests return 404, including the
status endpoint. `POST /api/auth/quick-login` accepts only `{ persona }`, uses
the normal CSRF token/origin check, regenerates the session, updates last login,
and returns the usual `nextPath`. An enabled, unlocked browser shows the
**QUICK LOGIN — TESTING** card below the normal sign-in card, with one button per
persona. Locked/disabled browsers show no testing card or hint.

Signed-in test accounts have an amber banner above the app header, including
during applicant onboarding. Use **Switch account** to choose another persona,
or **Sign out** to return to sign-in. Switching clears the previous user's
cached data and refreshes the session and CSRF token before navigation.
The **PRODUCTION** pill and **Hide test logins on this device** link are shown
on the sign-in testing card only when the API reports production mode.

Unlock attempts are limited to 5 per IP/hour; login attempts to 30 per IP/hour.
The runtime logs a loud warning and disables quick login if the production key
is missing/short, without failing otherwise-valid app startup.

Every quick login has a notification-free structured audit record with the
test user as actor, persona, IP, and user agent. Volunteer logins also appear
in their activity history. No schema changes or migrations are needed here.

## Schema and publishing

The generated migration adds only `users.is_test_account` (non-null, default
`false`) and the `suppressed` notification status. It is a record of the change.
Replit Publish remains responsible for applying the production schema. No
startup migration, migration baseline, production `db push`, or production
seed script is added. Publish the schema change before starting the new release.

## Resetting

Admin → Team → Test accounts lists all five personas and their last login.
Reset requires confirmation and restores only these flagged QA identities.
It clears their assignments, weeks off, inbox memberships, profile edits,
onboarding answers, and authentication tokens; invalidates their sessions;
and records the action in activity history. Non-test email collisions stop
the operation without changing any accounts.

Production never automatically assigns a QA shift. Development gives Active
one standing shift on creation/reset if an existing slot has capacity.
Active — No Shift always starts without a shift.

## Operational safeguards

- Test mail is suppressed before contacting Postmark, recorded as `suppressed`,
  and printed only outside production. Suppression applies by user ID or email.
- Suppressed rows do not count toward usage and are deduplicated.
- Global volunteer blasts exclude QA users; a direct single-recipient message
  remains available. Admin alerts and digests exclude the test admin.
- QA volunteers are hidden by default in the roster. “Show test accounts”
  reveals them without including them in status or needs-attention totals.
- Roster, schedule, and onboarding CSV exports exclude QA accounts.
- QA assignments still use real capacity; staff views mark them with TEST.
- The test administrator does not count toward first-admin setup or the
  last-real-admin protection.

The quick-login key must stay in Replit Secrets and must never be embedded in
frontend code, logs, or this document. Use the dedicated unlock URL only in a
trusted browser; do not share it or paste the full URL into screenshots or logs.
