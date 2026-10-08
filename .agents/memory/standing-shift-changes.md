---
name: Standing shift change timing
description: Immediate release and fresh-enrollment semantics for volunteer shift changes.
---

Volunteer changes and drops release the old standing shift immediately, not at the replacement's first occurrence. A change can leave a gap until the new weekday; its confirmation must state that the previous shift is released when confirmed.

**Why:** the requested change is an atomic end-and-create operation, and retaining the old standing seat until a later date would make maximum-shift and overlap rules ambiguous.

**How to apply:** maintain immediate-release semantics in future volunteer and staff scheduling actions unless the user explicitly requests a deferred change option.

A fresh re-enrollment must not silently inherit future weeks off from an enrollment that was cancelled, even if the same weekday/start date is chosen again.

**Why:** the confirmation promises a new weekly schedule beginning on the chosen date; inherited absences would make that confirmation inaccurate.

**How to apply:** preserve cancellation history while treating re-enrollment as a fresh weekly commitment.
