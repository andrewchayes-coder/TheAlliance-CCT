---
name: New-tab document links
description: Router links can ignore target=_blank; use native anchors for documents.
---

Use native anchors, not router Link components, for document links that must open in a new tab. Include the artifact base prefix for local document routes.

**Why:** browser testing showed that this project's Wouter Link intercepted a normal click despite `target="_blank"`, replacing the onboarding page instead of preserving it in its original tab. The installed router's click handler does not check the target attribute.

**How to apply:** preserve native browser navigation for new-tab links in forms and resource views. Recheck this behavior before changing those anchors back to router links after a router upgrade.
