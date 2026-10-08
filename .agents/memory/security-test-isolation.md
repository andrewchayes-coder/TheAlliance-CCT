---
name: Notification test isolation
description: Why reminder/broadcast browser QA must isolate its complete API and data scope.
---
Reminder and broadcast smoke tests must use an isolated data scope and API, not merely individually owned test users in the shared development database.

**Why:** jobs enumerate all eligible occurrences and broadcasts/coverage alerts can email staff outside the fixture set. Deleting owned rows afterwards cannot undo those sends or their effects on shared quotas.

**How to apply:** disable real delivery and background scheduling in the test API, verify the data scope before starting it, and clean up only that scope. Preserve real uniqueness and foreign-key constraints.
