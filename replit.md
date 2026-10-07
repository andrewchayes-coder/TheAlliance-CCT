# Alliance Volunteer Portal

A mobile-first volunteer management portal for The Alliance's Resource Coordination Program.

## Current scope

The brand foundation, full database model, and development seed are implemented. No authentication, volunteer signup/approval, scheduling, messaging, resource hub, or administrative data screens/endpoints exist yet. UI navigation samples are labelled previews.

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
- `pnpm --filter @workspace/db run push` applies development schema changes.
- `npm run seed` (or `pnpm run seed`) adds the development fixtures. It refuses production and other explicit non-development NODE_ENV values; an unset NODE_ENV is treated as a local development invocation.
- `pnpm --filter @workspace/scripts run verify-seed` checks fixture counts, insert validation, safe profile projection, placeholder PDFs, and database constraints. Constraint probes roll back completely; never run this on production.

## Stack and source map

- Client: React, Vite, TypeScript, Tailwind, shadcn/ui, wouter, TanStack Query in `artifacts/alliance-volunteer-portal/src/`.
- Server: Express and TypeScript in `artifacts/api-server/src/`.
- Shared configuration: `shared/appConfig.ts`, imported as `@workspace/shared/appConfig`.
- Shared date helpers: `shared/time.ts`, imported as `@workspace/shared/time`.
- Drizzle schema source: `shared/schema.ts`, including all 11 tables, enums, indexes, insert schemas, inferred types, and safe public projections.
- Seed script and fixtures: `scripts/src/seed.ts`, `scripts/src/seed-fixtures.ts`, `scripts/src/seed-support.ts`.
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
- Calendar-only fields use validated YYYY-MM-DD strings, not timestamps; shift clock times are Pacific wall times.
- Future volunteer queries must use `volunteerProfilePublicColumns` and the public schema/serializer. Never return a raw profile containing adminNotes. Never return passwordHash or tokenHash to a client.
- `isActive = false` means a deactivated user; future authentication must refuse sign-in. No sign-in behavior is implemented yet.
- The seed uses stable UUIDs, a transaction, and conflict-do-nothing inserts. Reruns never delete rows, reset credentials, or overwrite edited fixtures.
  **Why:** repeatable dummy data must not destroy existing development work.
- Seed passwords are salted scrypt hashes with their cost parameters encoded. Dummy volunteers receive randomized, undisclosed passwords; only the specified development admin credential is known. Authentication implementation is deferred.

## Development fixtures

- One verified admin and 18 fictional volunteers: 4 applicant, 3 in_training, 10 active, 1 inactive. All emails use example.org and phone numbers use the reserved 555-01xx fictional range.
- Twenty weekday slots (09:00–11:00, 11:00–13:00, 13:00–15:00, 15:00–17:00), capacity two; 18 standing assignments across the active volunteers leave intentional gaps.
- Two occurrence skips and one upcoming observed US federal holiday closure. The closure is dummy data, not an Alliance holiday policy.
- Two messages with recipients, and three documents, three articles, and three links; two links are quick links with placeholder URLs.
- Three clearly marked placeholder PDFs are generated under the frontend's `public/seed-resources/`. These are static seed fixtures, not an upload or document-storage feature.
- The seed does not send mail or generate live auth tokens.

## Optional brand assets

Place the logo at `artifacts/alliance-volunteer-portal/public/brand/logo.svg` and the licensed Lulo Clean font at `artifacts/alliance-volunteer-portal/public/fonts/LuloClean.woff2`. Restart the frontend workflow after adding either asset.

Absent assets use the display-font wordmark and Montserrat 800. Open Sans 400/600/700 and Montserrat 800 load from Google Fonts. Do not invent a replacement logo.
