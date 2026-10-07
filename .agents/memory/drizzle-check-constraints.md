---
name: Drizzle named check-constraint updates
description: Verify live PostgreSQL checks after editing an existing named constraint.
---

Do not assume a successful Drizzle schema push updated an existing named CHECK constraint's expression.

**Why:** the installed Drizzle tooling created a new table and reported success but left the old named assignment-date check unchanged. Cancelling a future reservation failed until the development constraint was explicitly updated.

**How to apply:** keep the schema source authoritative, inspect the live constraint definition, and if necessary apply a narrowly scoped development-only ALTER. Preserve ordinary validity checks, accounting for SQL NULL semantics when adding nullable alternatives. Production changes go through Replit's Publish schema diff; never add startup or deploy-time DDL.
