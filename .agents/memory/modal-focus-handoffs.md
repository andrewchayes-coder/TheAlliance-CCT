---
name: Modal focus handoffs
description: Coordinate modal closing with explicit navigation to another section of the page.
---

When a dialog action intentionally moves the user to another section, transfer its close-time focus restoration to that destination. Ordinary cancellation must still restore the original opener.

**Why:** Dialogs restore focus after closing; that later restoration can pull the viewport back to the old card even when the parent already focused and scrolled to the replacement choices.

**How to apply:** Explicitly distinguish a navigation handoff from ordinary dismissal. Preserve the handoff intent through unmount, focus the destination without another scroll, and avoid arbitrary timer delays or broadly disabling dialog focus restoration.
