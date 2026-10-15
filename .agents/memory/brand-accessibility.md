---
name: Brand accessibility
description: CCT contrast constraints, exact placeholder styling, and private-resource-safe home-screen support.
---

Use the final CCT Alliance Blue for actions and text on white. Gray surfaces need navy text, not blue.

**Why:** Blue on white measures 5.09:1, but blue on brand gray is only 4.08:1. The client's final guide explicitly prohibits blue text on gray and supersedes the earlier palette.

**How to apply:** Audit effective backgrounds, including selected filters and nested cards. Keep navy field labels and blue rings; white text on blue actions passes AA.

The final guide explicitly specifies 60% navy placeholders on gray, which are below 4.5:1. Preserve that exact requirement unless the user authorizes a contrast change, and disclose the exception rather than claiming full AA.

**Why:** This was a conflict between the final supplied styling and the earlier accessibility goal.

**How to apply:** Maintain full-contrast labels and do not use placeholders as the only instructions. If asked to achieve full AA, flag this required adjustment.

Measure native checkbox and radio targets in the browser rather than assuming padding enlarges them.

**Why:** Chromium kept the native controls at 24px despite added padding during the mobile accessibility audit.

**How to apply:** Use actual control dimensions or an associated, generously sized label, and verify the rendered clickable area meets the requested 44px minimum.

Home-screen support is manifest-based, without a generic offline service worker.

**Why:** The portal's authenticated documents and personal data must not become available from an unconditional cache after access is removed.

**How to apply:** If offline support is explicitly requested later, design account-scoped caching and logout/access-revocation handling first.

Check narrow data tables for readable headings, not only horizontal overflow.

**Why:** A table can pass the no-overflow check while inherited arbitrary word wrapping and large label typography compress its headings into one letter per line. The initial mobile hours trend had this failure.

**How to apply:** Inspect the rendered table on a phone. Give compact numeric tables appropriately sized headings and intentional word boundaries; put decorative bars inside a flexible column instead of reserving a competing fixed-width column.
