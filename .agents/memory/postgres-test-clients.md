---
name: Postgres test client inference
description: Avoid the callback overload when inferring pg connection types through workspace exports.
---
Infer a test client's type from a no-argument async wrapper that calls `pool.connect()`, not from `ReturnType<typeof pool.connect>`.

**Why:** the overloaded method's last signature can be the callback overload returning void. Direct `pg` imports may also be unavailable in artifact packages that intentionally consume the database through the workspace library.

**How to apply:** define an async connection wrapper, then use its awaited return type for minimal test doubles. Do not add a redundant database dependency or weaken production types to fix a test seam.
