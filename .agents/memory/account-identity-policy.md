---
name: Account identity changes
description: Why pending email changes preserve access and public QA identities have restricted account-editing writes.
---

Keep the current verified email working while a new email awaits verification. Require current-password proof for self changes; staff may request a teammate's change without learning their password. Close existing sessions after confirmed identity or password changes.

**Why:** failed or delayed email delivery must not lock someone out, and staff account recovery should not expose passwords.

**How to apply:** preserve this behavior in future identity-provider and account-recovery work, rather than immediately replacing the primary email or removing verification.

Public quick-login test administrators may only change test accounts through account-editing controls.

**Why:** production QA logins are deliberately accessible without an unlock key; they must not gain a new way to take over real accounts through email changes.

**How to apply:** re-check the stored actor and target test-account flags for managed account writes; don't trust flags supplied by the client.
