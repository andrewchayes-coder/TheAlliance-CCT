---
name: Auth navigation
description: Preserve explicit destinations across session-changing actions and automatic route guards.
---

For explicit destinations after session-invalidating actions, use a fresh-page transition or coordinate auth state and guards before navigating. Restarting signup and returning to sign-in after a password change use fresh-page transitions.

**Why:** successful signout did not guarantee the requested signup destination: SPA navigation repeatedly ended at signin, including with a local redirect-suppression flag. A fresh-page transition was browser-verified to reach signup correctly.

Password changes also exposed this issue: credentials and session invalidation succeeded, but SPA refresh/navigation returned to a dashboard stuck loading with 401s, and the in-memory success notice was lost.
The fresh-page password-change transition was then browser-verified to reach the exact sign-in destination with its success notice.

**How to apply:** do not simplify session-changing navigation to an ordinary SPA route change without checking the exact resulting URL/page as well as the server session. API success and type checks cannot confirm route/guard ordering.

For cross-role quick login, do not refresh/publish the new identity to the old SPA guards before the full-page transition. Return the successful response promptly, invalidate without refetching, and let the fresh page load its own identity.

**Why:** refreshing before navigation still produced a volunteer-to-admin hang even after the caller was changed to full navigation; the old route's guards could run during that refresh.

Success feedback must survive a fresh-page transition. Use a non-sensitive, one-use notice that is consumed and removed from the URL, not exclusively in-memory state. Never put passwords, user details, or authentication tokens in that notice.

Account switches need both query-cache isolation and an explicitly uncached
session/identity refresh. Cancel in-flight session requests as well as
user-specific requests before refreshing the new identity.

**Why:** A browser check observed the previous identity from an ordinary fetch
after the new test-account banner appeared; an uncached read returned the new
identity. The underlying caching/race cause was not established. Query keys are
shared across identities, so invalidation alone is not sufficient protection.

**How to apply:** Keep authenticated API requests explicitly uncached and clear
the previous account's cached data before completing a switch. Verify the
finished identity and CSRF state, not merely the unchanged dashboard URL.
