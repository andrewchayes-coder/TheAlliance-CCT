---
name: Workspace package installer scope
description: Recover a package-helper root-guard failure without changing workspace safety settings.
---

After a language package helper fails with `ERR_PNPM_ADDING_TO_ROOT`, install the dependency in its intended workspace package using a scoped pnpm command.

**Why:** the helper has no package-directory parameter and attempted `pnpm add` at this workspace's root. That failed before installing the requested dependency; the scoped artifact install succeeded.

**How to apply:** follow the package-management skill first. If this specific root-guard failure occurs, use `pnpm --filter <package> add [-D] <dependency>` as appropriate. Do not disable the root safety check or put an artifact-only dependency at the workspace root merely to bypass the error.
