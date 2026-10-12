---
name: Onboarding question scope
description: The client finalized onboarding as a fixed profile, with compliance paperwork handled outside the app.
---

The client finalized onboarding as a fixed profile rather than the earlier provisional questionnaire. Extra questions are now empty; training, compliance paperwork, and acknowledgments are handled outside the app.

**Why:** the user explicitly replaced the provisional questionnaire with finalized Community Care Team onboarding requirements.

**How to apply:** preserve legacy answers and compliance columns without data loss. Keep optional questions configurable and hide their section when empty; certification, background-check, and agreement tracking must be controlled by feature flags rather than deleting their data.

Program approval must remain a manual staff decision, separate from email verification, submitted onboarding, and account login access. Do not introduce automatic approval, a persisted review-completed state, or new approval requirements.

**Why:** the user explicitly excluded those changes when clarifying volunteer review and activation.

**How to apply:** improve review discoverability and explain existing prerequisites without changing authentication policy or adding a second approval workflow.
