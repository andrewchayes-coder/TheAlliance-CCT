---
name: Email retry safety
description: Preserve hash-only authentication tokens and distinguish retry confirmation from uncertain provider delivery.
---
Encryption was deliberately rejected for saved authentication email copies.

**Why:** the authentication requirement is hash-only storage. Replaying saved link bodies would both retain recoverable credentials and resend expired or consumed links.

**How to apply:** when introducing another account-token email type, preserve the hash-only mandate; do not treat general email-content encryption as an exception. Operational retry rules are documented in replit.md.

A historical retry can be deduplicated by a successful record other than the row staff clicked.

**Why:** changing a historical failure to a success would inflate monthly usage when another row already records the successful send.

**How to apply:** check which record confirms delivery before changing bookkeeping state. A skipped operation is not another physical email.
