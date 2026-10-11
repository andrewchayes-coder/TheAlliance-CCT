---
name: Static manifest MIME
description: Why dev header middleware does not validate production static-hosted manifest behavior.
---

For static-hosted frontend artifacts, a Vite development/preview response-header fix is not a production fix. Replit's static serving returned `text/plain` for a `.webmanifest` file during production QA; a `.json` manifest uses browser-accepted JSON MIME without runtime middleware.

**Why:** the earlier manifest fix passed development HTTP checks but failed the production test run because production bypassed Vite.

**How to apply:** inspect the artifact's production serving mode before choosing a header or routing solution. Verify the built asset and its HTML link, and include a post-Publish check of the actual response body/type rather than treating a dev response as production evidence.
