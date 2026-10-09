---
name: Production migrations
description: Production rollout safety and the reason migrations run in runtime context.
---
Use versioned migrations, never push or seed, for production rollout. Do not copy development fixtures into production.

**Why:** the user explicitly requires a separate production database and no production seeding. Build-time database context is not a reliable substitute for the deployment's runtime production connection.

**How to apply:** keep migrations in the runtime startup sequence before serving requests. Existing push-created schemas need reviewed reconciliation/baselining, not blind history stamping or deletion. Inspect schema metadata, not volunteer rows, during readiness work.

Drizzle's migration-history checker prepends a relative prefix to its output path; an absolute output path can generate successfully but fail history checks.

**Why:** this occurred during migration preparation even though the generated snapshot existed.

**How to apply:** use package-relative migration output and execute the CLI from that package; keep schema paths absolute if needed.

For an existing published app, select the requested deployment type in Publishing; a saved source target alone does not establish the provider used by the next publish.

**Why:** a publish still created an Autoscale service after the source target had been set to Reserved VM.

**How to apply:** verify Publishing settings and actual build/provider metadata before claiming the deployment type changed.
