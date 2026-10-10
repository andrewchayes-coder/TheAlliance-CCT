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
