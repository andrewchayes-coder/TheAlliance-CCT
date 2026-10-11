---
name: Operating week defaults
description: Weekend defaults for the master schedule and coordinator coverage statistics.
---

On Saturday and Sunday, the master schedule's default/Today selection and admin-home “This week” statistics use the coming Monday–Friday week, not the week that just ended. Explicitly selected weeks remain unchanged.

**Why:** the user requested this after the October 11, 2026 production test run.

**How to apply:** use the weekend-aware default only for presentation and overview coverage. Keep calendar-week normalization and live On shift now logic unchanged, including custom weekend shifts.
