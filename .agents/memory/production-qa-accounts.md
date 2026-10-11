---
name: Production QA accounts
description: Explicit approval for built-in synthetic QA personas in production, distinct from copying development fixtures.
---

The user wants the same five built-in QA personas available in development and
production. This is an intentional exception to the ban on production seed data,
not permission to copy development volunteers or other fixtures into production.

**Why:** The user explicitly requested production QA personas while requiring
that they not pollute real operations or take over non-test identities.

**How to apply:** Keep production schema changes managed by Replit Publish.
QA identities are created by application code only when enabled. Treat any
non-test email collision as a stop, not permission to convert an existing user.
Production QA starts/resets without shifts; subsequent tester-selected shifts
intentionally consume real capacity.

Locked or disabled production QA endpoints intentionally return 404 rather than
403. A 404 may mean the browser has not been unlocked, not that routing is broken.
An enabled flag with a missing/short access key disables QA access with a warning;
it must not prevent ordinary staff sign-in or application startup.

**Why:** The user requested non-disclosure of the QA feature and continued
availability of the normal application when the optional QA key is misconfigured.

**How to apply:** Preserve the production enable/unlock gates when investigating
missing QA controls. Do not bypass them just to make a button appear.
