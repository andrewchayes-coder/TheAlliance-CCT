---
name: Auth navigation
description: Preserve explicit destinations across session-changing actions and automatic route guards.
---

For an explicit post-signout destination, use a fresh-page transition or coordinate auth state and guards before navigating. The current choice for restarting signup is a fresh-page transition.

**Why:** successful signout did not guarantee the requested signup destination: SPA navigation repeatedly ended at signin, including with a local redirect-suppression flag. A fresh-page transition was browser-verified to reach signup correctly.

**How to apply:** do not simplify session-changing navigation to an ordinary SPA route change without checking the exact resulting URL/page as well as the server session. API success and type checks cannot confirm route/guard ordering.
