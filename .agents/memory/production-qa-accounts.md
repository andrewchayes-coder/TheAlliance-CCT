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

Production quick login is controlled only by QUICK_LOGIN_ENABLED. When on, anyone who opens /signin can use the test personas; that's intentional while the app is in testing. When off, the routes return 404.

**Why:** The user explicitly requested a single production on/off switch for testing.

**How to apply:** Check only the flag when investigating missing test controls. Turn it off and republish before inviting real volunteers; reset QA accounts after production testing.

Persona replacements must reuse the existing synthetic identity and history,
not create a second user. Ordinary preparation preserves saved QA progress;
an explicit reset restores the persona's starting state.

**Why:** The user requires exactly five test users and no orphaned identities.
Repeated account switching should not erase the profile or status just tested.

**How to apply:** Perform a one-time identity update for a replaced persona.
If both identities already exist, stop for review rather than automatically
merging histories or deleting users. Never convert a non-test account.
