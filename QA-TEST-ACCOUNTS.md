# Built-in QA accounts

The five personas in `shared/testAccounts.ts` are created by app code at startup
when quick login is enabled. Development enables them automatically; production
requires only `QUICK_LOGIN_ENABLED=true`. No password is returned,
stored in the persona config, or displayed. Password and Google sign-in cannot
be used to access these accounts.

## Quick login (testing)

Development is always enabled. Production is enabled only when
`QUICK_LOGIN_ENABLED`, trimmed and lowercased, equals `true`. Set it to
`false` to disable testing and republish after either change.

When enabled, anyone opening `/signin` can use all five test personas,
including the Admin persona, which opens the real admin view. This is intentional
while testing. Reset test accounts after production testing and turn the switch
off before inviting real volunteers. Disabling the switch prevents new quick
logins; reset also invalidates existing test-account sessions.

`GET /api/auth/quick-login/status` returns only persona keys, labels, roles, and
descriptions. Disabled production requests return 404, including the
status endpoint. `POST /api/auth/quick-login` accepts only `{ persona }`, uses
the normal CSRF token/origin check, regenerates the session, updates last login,
and returns the usual `nextPath`. When enabled, every browser shows the
**QUICK LOGIN — TESTING** card below the normal sign-in card, with one button per
persona. Disabled production shows no testing card or hint.

Signed-in test accounts have an amber banner above the app header, including
during onboarding. Use **Switch account** to choose another persona,
or **Sign out** to return to sign-in. Switching clears the previous user's
cached data and refreshes the session and CSRF token before navigation.
The **PRODUCTION** pill is shown
on the sign-in testing card only when the API reports production mode.

Login attempts are limited to 30 per IP/hour. Only flagged, active, verified
test users with the persona's expected role can be signed in. Ordinary accounts
are never eligible. Normal CSRF/origin checks and session regeneration remain.

Personas: Admin; Volunteer · Active; Volunteer · Active, no shift;
Volunteer · Onboarding, ready to activate; Volunteer · Onboarding, new.

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
It clears their standing assignments, cancels their one-time claims with
`cancelledAt`, and clears weeks off, inbox memberships, profile edits,
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
