---
name: QA test isolation
description: Isolate email side effects and namespace fixture queries in shared development data.
---
Reminder and broadcast smoke tests must use an isolated data scope and API, not merely individually owned test users in the shared development database.

**Why:** jobs enumerate all eligible occurrences and broadcasts/coverage alerts can email staff outside the fixture set. Deleting owned rows afterwards cannot undo those sends or their effects on shared quotas.

**How to apply:** disable real delivery and background scheduling in the test API, verify the data scope before starting it, and clean up only that scope. Preserve real uniqueness and foreign-key constraints.

Production-mode email-route tests should still use an isolated development data scope and a mocked provider, not a real Postmark connection or a log-only fixture.

**Why:** production intentionally refuses log-only email delivery. A route test that merely flips NODE_ENV on a development fixture will fail for configuration rather than test the production access rules.

**How to apply:** isolate production email behavior behind a mocked provider. Assertions must distinguish real delivery, log-only development delivery, and test-account suppression.

Paginated integration-test assertions must narrow queries to their owned fixture namespace before asserting which record appears.

**Why:** the development database can simultaneously contain browser fixtures and other test runs; a global sorted first-page assertion can fail even when filtering and sorting are correct.

**How to apply:** use a fixture email or namespace in integration queries; verify global sorting and counting with pure projections or controlled snapshots rather than assuming the shared database is otherwise empty.
