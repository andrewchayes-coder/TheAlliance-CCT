# Community Care Team Volunteer Portal

A mobile-first portal for The Alliance's Community Care Team. Resource Coordinators prepare to serve local families, choose standing shifts, find guides, and read staff messages. Alliance staff coordinate volunteers and coverage.

## Development

Run the configured API and web workflows. The development-only `/style-guide` documents the approved CCT colors, Open Sans typography, controls, logos, and email presentation.

Product identity, mission, and staff contact are configured in `shared/appConfig.ts`. See `DEPLOY.md` for production setup and `QA-CHECKLIST.md` for user acceptance checks. Production schema changes remain managed by Replit Publish; no startup migrations or production seed runs.

## Brand assets

Assets are bundled in `artifacts/alliance-volunteer-portal/public/brand/`, not downloaded from App Storage at runtime:

| Object Storage source | Local static file |
|---|---|
| `public/logo-horizontal.png` | `/brand/logo-horizontal.png` |
| `public/logo-stacked.png` | `/brand/logo-stacked.png` |
| `public/logo-mark.png` | `/brand/logo-mark.png` |
| `public/favicon-32.png` | `/brand/favicon-32.png` |
| `public/apple-touch-icon.png` | `/brand/apple-touch-icon.png` |
| `public/icon-192.png` | `/brand/icon-192.png` |
| `public/icon-512.png` | `/brand/icon-512.png` |

The bucket also contains `public/CCT Logo1.png` and `public/CCT Logo2.png`; these additional files are not used at runtime. The already-named horizontal and stacked PNGs were visually checked before copying. Use white behind the navy artwork.
