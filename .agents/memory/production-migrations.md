---
name: Production migrations
description: Publish-owned production schema changes and safe verification of existing constraints.
---
Production schema changes are managed by Replit Publish. Do not run Drizzle migrations, schema push, startup DDL or seed in production, and do not copy development fixtures.

**Why:** the user explicitly chose Publish-owned production schema changes and removal of the boot-time migration hook and guard. A separate runtime migrator competes with Replit's schema synchronization.

**How to apply:** retain configuration validation but no schema mutations in startup. No Drizzle baseline is needed for Publish-managed operation. Inspect read-only metadata and Publish's proposed SQL; do not silently stamp history or modify production rows.

Do not assume Publish replaces a named CHECK constraint whose expression changed.

**Why:** Publish applied other schema changes but omitted two changed existing CHECK definitions even though development had the correct expressions.

**How to apply:** look for explicit constraint replacements in the Publish diff and verify actual definitions afterward. If omitted, flag an operator-reviewed correction rather than adding a startup workaround.

Drizzle's migration-history checker prepends a relative prefix to its output path; an absolute output path can generate successfully but fail history checks.

**Why:** this occurred during migration preparation even though the generated snapshot existed.

**How to apply:** use package-relative migration output and execute the CLI from that package; keep schema paths absolute if needed.

For an existing published app, select the requested deployment type in Publishing; a saved source target alone does not establish the provider used by the next publish.

**Why:** a publish still created an Autoscale service after the source target had been set to Reserved VM.

**How to apply:** verify Publishing settings and actual build/provider metadata before claiming the deployment type changed.

Keep the existing volunteer status enum/column and extend it additively for simplified statuses; retain deprecated values and normalize legacy reads until a separately approved data backfill.

**Why:** the user explicitly rejected both a new status column and a type conversion, choosing Publish-owned additive changes with no dropped or renamed data.

**How to apply:** generate reference SQL without running it at startup. Treat production schema changes and production data updates separately; give data backfills as short, individual SQL statements for the user to run.
