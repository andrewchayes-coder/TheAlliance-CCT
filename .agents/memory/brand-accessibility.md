---
name: Brand accessibility
description: Resolve the original teal palette and home-screen support against accessibility and private-resource requirements.
---

Use accessible teal variants for white-text actions and small labels on gray surfaces, rather than restoring the exact bright teal fill from the original brand brief.

**Why:** The requested AA contrast takes priority when the original bright teal fails contrast for small white text. Labels must work on gray as well as white.

**How to apply:** Keep the original hue for accents and focus rings; use the accessible action/text variants for controls and labels when extending the design.

Measure native checkbox and radio targets in the browser rather than assuming padding enlarges them.

**Why:** Chromium kept the native controls at 24px despite added padding during the mobile accessibility audit.

**How to apply:** Use actual control dimensions or an associated, generously sized label, and verify the rendered clickable area meets the requested 44px minimum.

Home-screen support is manifest-based, without a generic offline service worker.

**Why:** The portal's authenticated documents and personal data must not become available from an unconditional cache after access is removed.

**How to apply:** If offline support is explicitly requested later, design account-scoped caching and logout/access-revocation handling first.
