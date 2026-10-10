# Built-in QA accounts

The five personas in `shared/testAccounts.ts` are created by app code at startup
when quick login is enabled. Development enables them automatically; production
requires `QUICK_LOGIN_ENABLED=true`. No password or quick-login key is returned,
stored in the persona config, or displayed. Password and Google sign-in cannot
be used to access these accounts. Quick-login entry points belong to the next prompt.

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

The quick-login key must stay in Replit Secrets and must never appear in
frontend code, logs, URLs, or this document.
