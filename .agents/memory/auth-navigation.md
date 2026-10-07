---
name: Auth navigation
description: Preserve explicit destinations across session-changing actions and automatic route guards.
---

For explicit destinations after session-invalidating actions, use a fresh-page transition or coordinate auth state and guards before navigating. Restarting signup and returning to sign-in after a password change use fresh-page transitions.

**Why:** successful signout did not guarantee the requested signup destination: SPA navigation repeatedly ended at signin, including with a local redirect-suppression flag. A fresh-page transition was browser-verified to reach signup correctly.

Password changes also exposed this issue: credentials and session invalidation succeeded, but SPA refresh/navigation returned to a dashboard stuck loading with 401s, and the in-memory success notice was lost.
The fresh-page password-change transition was then browser-verified to reach the exact sign-in destination with its success notice.

**How to apply:** do not simplify session-changing navigation to an ordinary SPA route change without checking the exact resulting URL/page as well as the server session. API success and type checks cannot confirm route/guard ordering.

Success feedback must survive a fresh-page transition. Use a non-sensitive, one-use notice that is consumed and removed from the URL, not exclusively in-memory state. Never put passwords, user details, or authentication tokens in that notice.
