---
name: Development cookie proxy
description: Distinguish app cookie configuration from development edge rewriting.
---

Do not infer the application's session-cookie configuration solely from a proxied development response.

**Why:** direct requests to the running API emitted HttpOnly, Secure, SameSite=Lax, while requests through the HTTPS development domain emitted HttpOnly, Secure, SameSite=None. Both were measured against the same running build. Official documentation did not explain this behavior, so its purpose or behavior on published apps must not be assumed.

**How to apply:** when debugging cookie attributes, compare direct server responses (simulating trusted HTTPS forwarding) with the HTTPS development proxy without displaying cookie values. Preserve the requested app settings unless the actual app configuration is wrong; inspect published headers separately when publishing.
