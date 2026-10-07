# Alliance Volunteer Portal

A mobile-first volunteer management portal for The Alliance's Resource Coordination Program.

## Current scope

The initial pass is the project foundation and brand system only. No authentication, volunteer signup/approval, scheduling, messaging, resource hub, or administrative data features exist yet. UI navigation samples are labelled previews.

The `/style-guide` route and its lazy-loaded module are development-only. The root page is a restrained portal entry, not an authentication screen.

## Product context

- Volunteers will be verified and approved by staff, then sign up for recurring two-hour phone shifts Monday–Friday.
- The pilot is 12–15 volunteers in Placer County, growing to about 60 across five counties.
- Excellent phone usability is a requirement.
- The counties in appConfig are placeholders, not a final service-area commitment.

## Run & operate

- Managed frontend workflow: `artifacts/alliance-volunteer-portal: web`
- Managed backend workflow: `artifacts/api-server: API Server`
- `pnpm run typecheck` checks all libraries and applications.
- `pnpm --filter @workspace/api-spec run codegen` regenerates API types after contract changes.
- `pnpm --filter @workspace/db run push` applies development schema changes when tables are added.

## Stack and source map

- Client: React, Vite, TypeScript, Tailwind, shadcn/ui, wouter, TanStack Query in `artifacts/alliance-volunteer-portal/src/`.
- Server: Express and TypeScript in `artifacts/api-server/src/`.
- Shared configuration: `shared/appConfig.ts`, imported as `@workspace/shared/appConfig`.
- Shared date helpers: `shared/time.ts`, imported as `@workspace/shared/time`.
- Drizzle schema source: `shared/schema.ts`; intentionally no domain tables yet.
- PostgreSQL connection and Drizzle configuration: `lib/db/`.
- API contract: `lib/api-spec/openapi.yaml`; currently health check only.
- Brand CSS tokens: `artifacts/alliance-volunteer-portal/src/index.css`.
- Themed shadcn controls: `artifacts/alliance-volunteer-portal/src/components/ui/`.
- Brand layouts, status badges, and empty states: `artifacts/alliance-volunteer-portal/src/components/brand-system.tsx`.

## Architecture decisions

- Client and server remain separate managed artifact packages rather than literal root `client/` and `server/` directories; shared files live in the requested root `shared/` directory.
  **Why:** retain Replit's managed service routing and the existing pnpm workspace conventions without duplicating app code.
- All app settings come from `shared/appConfig.ts`; do not scatter copies of product settings across screens or server code.
- Store timestamps as UTC and display dates/times in `America/Los_Angeles`, including daylight-saving changes.
- Do not create domain tables or seed volunteer records during the foundation-only pass.

## Optional brand assets

Place the logo at `artifacts/alliance-volunteer-portal/public/brand/logo.svg` and the licensed Lulo Clean font at `artifacts/alliance-volunteer-portal/public/fonts/LuloClean.woff2`. Restart the frontend workflow after adding either asset.

Absent assets use the display-font wordmark and Montserrat 800. Open Sans 400/600/700 and Montserrat 800 load from Google Fonts. Do not invent a replacement logo.
