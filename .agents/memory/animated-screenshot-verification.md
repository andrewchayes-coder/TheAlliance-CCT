---
name: Animated screenshot verification
description: Distinguish transient panel entrance frames from persistent mobile layout problems.
---

When a browser screenshot shows a drawer or dialog clipped beyond the viewport, verify its settled geometry before changing positioning CSS.

**Why:** A browser check reported mobile admin navigation clipping, but the screenshot was taken during its entrance animation. After the animation finished, the panel and Close button were fully within the viewport.

**How to apply:** Wait until the panel's active animations finish, then inspect its bounding rectangle and Close control against the viewport. Prefer one focused diagnostic check over changing otherwise-correct layout or repeating the entire signed-in flow.

Apply the same rule to tap-target checks: a parent dialog's zoom animation temporarily shrinks `getBoundingClientRect()` even when a button has the correct 44px minimum height.

**Why:** Measuring immediately after the dialog becomes visible can falsely fail a correctly sized control.

**How to apply:** Poll for settled bounds or await the finite entrance animation before asserting physical target size; don't increase sizing just to compensate for an intermediate frame.
