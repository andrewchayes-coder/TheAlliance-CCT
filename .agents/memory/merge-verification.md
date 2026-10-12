---
name: Verify automatically reconciled changes
description: Full checks remain necessary after syncing with concurrent project edits.
---
After automated reconciliation with concurrent edits, verify the complete workspace and changed API regression suite, not only the files reported as conflicts.

**Why:** an automatically reconciled route acquired the wrong request validator, and a test file had declarations and test statements moved into unrelated scopes. Neither file was reported as a conflict; a frontend-only type check could not detect either problem.

**How to apply:** rerun the workspace type check and affected API tests against the reconciled state before completion. Preserve the tested implementation and incoming functionality while resolving discrepancies.
