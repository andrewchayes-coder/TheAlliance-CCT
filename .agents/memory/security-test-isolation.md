---
name: Notification test isolation
description: Why reminder/broadcast browser QA must isolate its complete API and data scope.
---
Reminder and broadcast smoke tests must use an isolated data scope and API, not merely individually owned test users in the shared development database.

**Why:** jobs enumerate all eligible occurrences and broadcasts/coverage alerts can email staff outside the fixture set. Deleting owned rows afterwards cannot undo those sends or their effects on shared quotas.

**How to apply:** disable real delivery and background scheduling in the test API, verify the data scope before starting it, and clean up only that scope. Preserve real uniqueness and foreign-key constraints.

Production-mode email-route tests should still use an isolated development data scope and a mocked provider, not a real Postmark connection or a log-only fixture.

**Why:** production intentionally refuses log-only email delivery. A route test that merely flips NODE_ENV on a development fixture will fail for configuration rather than test the production access rules.

**How to apply:** enable production semantics only inside the owned test process, supply synthetic email configuration with a mocked successful provider response, and assert the provider recipient and absence of provider calls for TEST accounts.
