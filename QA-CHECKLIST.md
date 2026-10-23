# Community Care Team — QA checklist

## F13 — Add to Calendar / v1.5.0

Run in development with synthetic QA personas unless a row explicitly calls for production UAT. Never paste a private capability URL into a shared tracker; redact the code as `XXXX`. All calendar provider checks use subscriptions, not a one-time ICS import.

| Test ID | Tag | Workflow | Steps | Expected result |
| --- | --- | --- | --- | --- |
| SYS-19 | NEW | Calendar automated tests and guard inventory | Run `npm test`; run `NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts exec tsx src/smoke.ts --calendar-only` for isolated Playwright. Check GET and HEAD `/api/calendar/:file` and GET/POST volunteer calendar declarations. Test an unknown/malformed link, HEAD, limits, concurrent first requests, reset, key recovery and DST. | Both feed methods are declared public; management is onboardedVolunteer. Unknown/malformed: identical 404 text. HEAD: calendar headers, no body, no connection write. Limits: 429/Retry-After at 120/token/hour or 30 unknown/IP/hour. Same owner gets one row/token under concurrent GETs. Reset invalidates old URL and writes one token-free audit entry. Playwright proves the live week-off update without cookies and removes its isolated fixture schema. |
| ONBR-05 | NEW | No calendar card before Active | Sign in as Volunteer · Onboarding, ready to activate. Open My Shifts before activation, with no held shift; inspect network requests. Then call GET `/api/volunteer/calendar` directly and fetch its feed URL. | No calendar card or page-initiated calendar-info fetch. This complete-but-not-active persona can call the API directly; its feed is valid and empty. Incomplete onboarding cannot access the management API. No other volunteer's calendar info is exposed. |
| ANS-09 | NEW | First booking and confirmation | As Volunteer · Active, no shift, book a weekly or one-time shift. Inspect confirmation, Home link and suppressed booking email. Claim a custom one-time shift and inspect its suppressed email. | Confirmation has the four provider links and Copy link. Home links to `/shifts#calendar` until first feed GET. Both emails have the new calendar sentence and no capability URL. If already connected, confirmation instead explains automatic pickup and offers Add to another calendar. |
| ACT-19 | NEW | Calendar card and provider links | As Volunteer · Active, open My Shifts at 375px and desktop. Inspect all provider hrefs; Copy link, reload, open `/shifts#calendar`. Also try clipboard-unavailable mode. | Card directly under Your shifts. Five controls ≥44px, clean wrapping, specified intro/refresh/privacy text, initially Not added to a calendar yet. Google URL contains unencoded webcal URL; both Outlook URLs encode HTTPS URL and CCT Shifts. Native provider anchors; Google/Outlook open a new tab securely. Apple uses webcal. Copy shows Link copied or a selectable read-only field. Same URL after reload. Hash navigation scrolls and focuses heading. |
| ACT-20 | NEW | Feed matches My Shifts | Give the persona a standing shift, week off, regular-slot one-time booking and claimed custom shift. Add a closed date and blocked occurrence as staff. Fetch copied link without cookies. | Valid CRLF/folded ICS from Pacific today −30 through +180 days, exactly the owner's expected occurrences. Closed, blocked and skipped dates absent. Each one-time shift appears once with (one-time). Correct Pacific/DST UTC instants, time/contact/My Shifts description. No peer identity or assignment ID, attendees, organizer or alarms. |
| ACT-21 | NEW | Live changes and stable events | Save feed UIDs. Change standing shift, take a week off and undo, cancel one-time booking/claim, drop eligible second standing shift; fetch after every action. | Old future events disappear, new ones appear, week-off Undo restores the same UID, cancelled/dropped dates vanish. Unchanged events retain UIDs. External providers pick changes up on their own refresh schedule, not necessarily immediately. |
| ACT-22 | NEW | Reset link | Copy URL, choose Reset my calendar link, inspect dialog, cancel once, then confirm. Fetch old and new links and inspect Recent activity. | Dialog warns existing subscriptions stop updating and existing events won't change; cancellation keeps current URL. Confirm shows Your calendar link was reset. Add your shifts to your calendar again. Old URL 404; new URL 200; connection status clears until a GET. Exactly one calendar_link_reset audit entry, no URL/token in details. |
| ADM-45 | NEW | Staff connection status and inactive feeds | Inspect volunteer detail before fetch. Fetch with Google-Calendar-Importer User-Agent; reload staff page. Set profile Inactive, deactivate, or archive in separate reversible checks and fetch. Reset QA personas; test old URL again and inspect admin API. | Not added changes to Connected to Google Calendar with Pacific date/time. Only coarse client and timestamp in staff API, never URL/token. Inactive/deactivated/archived feeds are valid empty 200 calendars. QA reset makes that persona's old URL 404; real feeds untouched. HEAD alone never says Connected. |
| PRD-19 | NEW | Real calendar subscriptions — production UAT after Publish | Review additive Publish diff, then subscribe an approved synthetic persona in Google Calendar on desktop, Outlook.com/work-school and Apple Calendar. Book one-time shift 2–3 days out, check appearance, cancel and check next day; restore persona state. | This feature adds only calendar_feeds (no existing column/enum changes). All services subscribe without sign-in to portal; correct Pacific shift time and one-time title. Portal/staff status updates after actual GET. Changes arrive within provider refresh windows; record observed Google latency. Do not run as part of development automation. |

### F13 coverage

| Prompt | Test IDs → checklist section |
| --- | --- |
| F13 | SYS-19, ONBR-05, ANS-09, ACT-19, ACT-20, ACT-21, ACT-22, ADM-45, PRD-19 → F13 — Add to Calendar |
| F13 | SYS-06 → Production readiness and operation (CHANGED); ADM-32 → Quick login and synthetic QA accounts (CHANGED) |

## NEW — Recurring and one-time shift sign-up

| Workflow | Steps and expected result |
| --- | --- |
| Weekly default | As an active volunteer, open My Shifts. Recurring weekly is selected. Book an open slot and verify the confirmation, recurring My Shifts card and next weekly dates. |
| One-time booking | Select One time on the grid or in the booking dialog. Choose an available date; confirm the date-specific open-spot count. Save, reload and verify a One-time shift card with exactly that date. The confirmation email must say it does not repeat. |
| Capacity and conflicts | Book with two weekly shifts already held; a non-overlapping one-time date remains allowed. A full, closed, blocked, past or overlapping date must not be bookable. Other volunteers' names must never be shown. Simultaneous claims must not overfill the last spot. |
| Cancel | Cancel a one-time booking more than 24 hours ahead, even with no other shifts held. Within 24 hours, show the staff contact instead. Weekly minimum-shift rules remain unchanged. |
| Week off coverage | Take a week off from a weekly shift. Another volunteer books that date once. Undoing the week off must refuse if it would exceed capacity. |
| Staff and history | Verify the one-time reservation appears on only its booked date in the master schedule, dashboard, reminders and subsequent hour-logging flow, including a DST week. |

## Account archiving — admin cleanup

| Workflow | Steps | Expected |
|---|---|---|
| Archive a volunteer | Use a separately owned non-QA test account. Add Other time, note the Reports total, then open its volunteer detail and choose Archive account. Read the confirmation and confirm. | Account is marked Archived; hours, profile, messages and activity remain. Sign-in is disabled, existing sessions end, tokens are revoked, and future standing/one-time shifts are released through the existing deactivation flow. Repeating archive adds no second archive activity or release. |
| Default lists and filters | Reload Volunteers and Team, search for the archived account, then choose Accounts → Archived and All accounts. Check roster CSV and message recipient search. Repeat at 375 px and desktop. | Hidden by default without reapplying a filter; Archived/All accounts expose it. Default roster CSV and new message audiences exclude it. Reports still include its recorded hours. Dialogs and filters work without horizontal overflow. |
| Restore without reactivation | From Archived in Team or volunteer detail, choose Restore account and confirm. | Returns to normal lists, but sign-in stays disabled. Prior shifts do not reappear. Hours and activity are unchanged; account restored is audited. Team allows a separate explicit Reactivate action afterward. |
| Protected accounts and permissions | Try archiving yourself, a built-in QA persona, the last active non-QA admin, and calling the archive route as a volunteer or without a session. Try invalid/extra input fields. | Self, last-active-admin and QA protections are enforced on the server. Volunteers get 403; unauthenticated callers get 401; invalid input is refused. An archived account cannot be reactivated without restoration. |

Automated checks: `npm test` includes the archive route/retention/access tests.
Development-only browser check: `NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts exec tsx src/smoke.ts --archive-only`.
These new workflows are not assigned master-plan IDs; the master persona document is unchanged.

Workflow steps for the Google Sheet UAT tracker. Master: [Alliance Persona Test Run](docs/Alliance%20Persona%20Test%20Run.md), preserved unchanged during this sync. **CHANGED:** All **136** v8 master IDs have a primary test row and a coverage-table entry. Coverage is a mapping, not a claim that manual UAT or optional features have passed.

## v1.1.0 workflow tags

- **NEW**: a master check missing as an explicit workflow in the earlier checklist.
- **CHANGED**: rewritten for current CCT branding, fixed-profile/status model, privacy, email identity or switch-only quick login; matching IDs added. Combined tags mean both.
- Every primary row puts its master ID beside its steps. Retained extra checks below have no exact matching master ID and are disclosed separately.
- Record tester, environment, date, Pass/Fail/Blocked and evidence beside each row when pasting into the tracker. **CHANGED:** An unaccepted master/app gap should be Blocked/Fail, not silently passed; SYS-08 explicitly tests the accepted tracking limit recorded below.

## Reminder jobs clarity — v1.1.5

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-39 | NEW | Reminder jobs explains the scheduler | In isolated development with RUN_JOBS off and no JOBS_SECRET, open Admin → Reminder jobs and click Run reminder check now. Optionally configure a 32+ character dummy JOBS_SECRET locally, restart, record one external run, then wait over 20 minutes without calling it. Restore every temporary setting afterwards. | Scheduler says Not scheduled (amber); top notice says reminders aren't scheduled. No Automatic scheduler / External trigger rows or autoscale note. Manual run source is Manual (Run reminder check now), plus Last scheduled run or No scheduled run yet. Tiles: Due, Sent, Logged (not delivered), Failed, Skipped, Test accounts (not sent), Carried to next run, Unconfirmed. Configured external scheduler shows cron-job.org. A previously recorded scheduled run over 20 minutes old shows the red stale warning; no recorded scheduled run shows the separate no-run warning. A failed scheduled run shows a red error with its time/error. On-time runs show green. Manual runs do not reset scheduled health. Built-in-only shows Built-in timer; both enabled shows the amber two-schedulers warning. Check at 375 px; all labels fit. |

**Master clarification:** ADM-39's optional steps omit recording an initial scheduled run. Without one, the specified page rule correctly shows “No scheduled run has been recorded yet,” not the red stale warning. Record a development external run before waiting to test staleness. Do not alter production settings or the master document for this test.

## Test safety and setup

Use isolated development data/API with external delivery disabled. Do not trigger shared reminders, broadcasts or real staff emails during regression. Production rows are instructions for a separately authorized operator, not actions performed by this sync. Never copy development fixtures or fabricate real volunteer profiles. Save evidence outside source control; attached_assets and generated-artifacts are ignored.

Personas: Admin; Volunteer · Active; Volunteer · Active, no shift; Volunteer · Onboarding, ready to activate; Volunteer · Onboarding, new. Reset before/after QA. Production reservations consume real capacity; reset after testing, then disable quick login and republish before inviting real volunteers.

Development-only seed commands:

```sh
NODE_ENV=development SEED_DATABASE_ENVIRONMENT=development npm run seed
NODE_ENV=development SEED_DATABASE_ENVIRONMENT=development npm run seed
NODE_ENV=development SEED_DATABASE_ENVIRONMENT=development pnpm --filter @workspace/scripts run verify-seed
npm test
pnpm run typecheck
```

## Test preparation and automation

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-01 | NEW; CHANGED | Seed | In development only, run `npm run seed` twice; count `users` and `volunteer_profiles` separately after each run. Never seed production. | Both runs finish without errors or duplicates and have matching counts. The seed creates 1 admin and 18 dummy volunteers, excluding the 5 separately created QA users. Only onboarding / active / inactive statuses, none applicant or in_training. There are 40 Mon–Fri slots, 09–11 through 16–18 with hourly overlap and capacity 2. Users and volunteer profiles are different row counts. |
| SYS-02 | CHANGED | Automated tests | Run `npm test`. | All pass, including scheduleService (DST weeks, full overlapping grid, two live overlapping shifts, skip date, closed date, blocked occurrence, custom shift in now/next and coverage, custom-shift reminder de-dupe, DST-week custom shift), the route-guard test, privacy tests (incl. DOB/address/emergency contact), the quick-login on/off tests (production is off unless `QUICK_LOGIN_ENABLED` is "true" in any case; no key or cookie tests remain; a persona mapped to a non-test user is refused), and ensureTestAccounts idempotency (5 test users after two runs). |
| SYS-03 | CHANGED | Route-guard test | Inspect the registered-route guard test and quick-login endpoints. | Quick-login routes tagged public:quick-login, not exempted via a blanket allowlist. Retired testing entry-point routes no longer registered; normal session/CSRF tests remain. |
| SYS-04 | CHANGED | Playwright smoke test (F8, F10, F11) | Run the isolated development Playwright smoke test. After the Tue 10–12 shift, use the dev clock to confirm 2 hours on Home, then inspect the volunteer's Hours card and Reports as staff. | Sign-up → verify → complete profile → automatically Active → picks Tue 10–12 → confirms 2 hours → staff sees the same entry and Team hours 2 in Reports (test toggle on for QA users) → remaining blocks/one-time shift/reminder/message/read flow passes. No manual activation. |
| SYS-05 | CHANGED | Leftover search | Search `artifacts/alliance-volunteer-portal`, `artifacts/api-server`, `shared` and `lib/db` for 02928F, 027A77, lulo, montserrat, Resource Coordination Program, applicant and in_training, using the master’s grep commands. Exclude dependencies, build output, migrations, `docs/` and the separate `artifacts/mockup-sandbox`. | No obsolete colors, fonts or program name in screens or emails. applicant / in_training remain only in the retained database enum and read-time mapping in `shared/legacy-compatibility.ts`. Review and explain other deliberate compatibility hits, such as email aliases, rather than automatically failing them. No obsolete values in `shared/testAccounts.ts`, UI copy or emails. |
| SYS-15 | CHANGED | Lighthouse | Run Lighthouse (mobile) accessibility on the volunteer dashboard, /onboarding, and admin home. | Each scores 95 or higher. |
| SYS-16 | NEW; CHANGED | Docs | Review DEPLOY.md, this checklist, CHANGELOG.md and QA-TEST-ACCOUNTS.md; run the QL-5 retired-access audit, excluding the unchanged master under docs. | Current grid/blocks/custom shifts, Postmark DNS and configured identity documented; true/false quick-login switch, republish, reset and turn-off-before-invites guidance. v1.1.0 recorded; no retired-access identifiers in active files. |
| SYS-18 | CHANGED | Master checklist synchronization (F13) | Run the master ID-diff command against the current Oct 21 v11 test plan; inspect workflows and coverage. | Empty diff; all 154 IDs covered, including calendar subscriptions, archiving and one-time booking workflows. MIL/NTF remain optional and unbuilt. |

## CCT brand and program identity

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-17 | CHANGED | Static brand files | List `artifacts/alliance-volunteer-portal/public/brand/` and inspect the response headers on `/brand/logo-horizontal.png`. | `logo-horizontal.png`, `logo-stacked.png`, `logo-mark.png`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` are present and served as static files with long Cache-Control headers, not from Object Storage. |
| VIS-01 | NEW | Style guide | Open /style-guide in dev. | Shows navy / Alliance Blue / gray / white only, Open Sans in sentence case (no forced uppercase), buttons, inputs, badges ("good" = blue), both logos, and an email preview. No blue text on gray. Works at 375 px. |
| VIS-02 | CHANGED | Sign-in page brand | Open /signin at 375 px and on desktop. | No navy band. Stacked logo centered (max 240 px) above the card. Mission line in 15 px navy under the card. Gray inputs with a blue focus ring. Primary button blue, hover navy. |
| VIS-04 | CHANGED | Favicon & home-screen icon (F9) | Check the browser tab and /manifest.json. On a phone, remove any earlier portal icon, then Add to Home Screen. | Home-screen icon is the CCT stacked logo on opaque white. Ordinary 192/512 icons and the separate 512 maskable icon use ?v=2; Apple uses the 180px touch icon. Browser favicon and mobile-header mark remain the circle mark. Manifest name, short_name and colors unchanged. |

## Public access and authentication

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| VIS-05 | CHANGED | Signed-out redirects | Visit /dashboard, /shifts and /admin. Call GET /api/me and GET /api/admin/volunteers. | Pages redirect to /signin. The APIs return 401. |
| VIS-06 | CHANGED | Forgot password is non-revealing | Submit /forgot-password once with an unknown email and once with a real one. | Both show the same confirmation message. |
| VIS-07 | CHANGED | Sign-in errors & rate limit | Sign in with a wrong password repeatedly. | Generic error (doesn't say which field is wrong), then a friendly rate-limit message. |
| NEW-01 | CHANGED | Sign-up | Go to /signup. Try a 7-character password and a mismatched confirmation, then sign up correctly with a matching password of at least 8 characters. | The 7-character password and mismatched confirmation are rejected; the minimum is 8 characters. Intro copy shows. The account is created and /verify-email displays the supplied email address. |
| NEW-02 | CHANGED | Verification gate (server-enforced) | While unverified, visit /dashboard, /shifts, /onboarding, then call a protected API (e.g. GET /api/shifts) from devtools. | Every page sends you back to /verify-email. The protected API returns 401/403, not data. |
| NEW-03 | CHANGED | Resend rate limit | Click "Resend email" twice within a minute. | The second click is blocked with a friendly message (1/minute, 5/hour). |
| NEW-04 | CHANGED | Unverified sign-in | Sign out, then sign back in before verifying. | You land on /verify-email. |
| NEW-05 | CHANGED | Verify link | Click the verification link (console in dev). | You're signed in and routed to /onboarding. |
| NEW-12 | CHANGED | Password reset | Sign out → Forgot password → open the reset link → set a new password → sign in. Then open the same reset link again. | Reset works and the new password signs in. The reused link fails. (Optional: a link older than 1 hour also fails.) |
| NEW-13 | NEW | Last login | Sign in, then check the roster as admin (ADM-18). | Last login shows this sign-in. |

## Fixed-profile onboarding

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-07 | CHANGED | Config flags (F8) | Inspect shared/appConfig.ts and shared/onboardingQuestions.ts. | autoActivateOnProfileComplete and trackBackgroundCheckAdminOnly true; minimumAge 18. Certification, volunteer-facing background tracking and agreement gates false; questions empty. Public contact remains Community Care Team. |
| SYS-08 | CHANGED | Staff-only background check (F8) | Open admin volunteer detail, roster and CSV; inspect volunteer pages and API responses. | Staff checkbox/date, filter, optional column and CSV completion/date available. No volunteer-visible background data, activation gate or attention reason. Old volunteer-facing flag stays false. |
| NEW-06 | CHANGED | Onboarding screen | Look over /onboarding. | One screen. Intro: "Welcome to the Community Care Team. A few details help us support you and reach someone if we ever need to." Email read-only; name and phone prefilled and editable. DOB, address, city, state (default CA), ZIP, emergency contact name / relationship (with suggestions) / phone. "Only Alliance staff can see this." under DOB and emergency contact. No questionnaire, no agreement checkbox, no county. |
| NEW-07 | CHANGED | Onboarding validation | Blur-save empty/null draft fields; then try a future DOB, invalid calendar date, 4-digit ZIP, short/nonnumeric phone, and overlong fields in the form and PATCH /api/onboarding. Repeat invalid nonempty values on volunteer Profile and the admin Profile card. Finish onboarding with required fields blank. | Empty/null drafts are allowed, but completion requires all fields. Invalid nonempty saves return 400 with fieldErrors and do not save the bad values. ZIP+4 is accepted; formatted US phones are stored as 10 digits. |
| NEW-08 | CHANGED | Save on blur | Fill about half the fields, then refresh. | Everything you entered is still there. |
| NEW-09 | CHANGED | Profile required before dashboard | Before finishing, go to /dashboard. | Redirected back to /onboarding. |
| NEW-10 | CHANGED | Finish onboarding (F8) | Complete every required field and submit; reload and submit again. | Active immediately with Pacific today's start date if missing; dashboard Choose your weekly shift. One welcome email: "Welcome to the Community Care Team: choose your weekly shift", with Shifts CTA. Resubmission sends nothing and never reactivates an inactive/reopened profile. Phones remain digits. |
| NEW-11 | CHANGED | Automatically Active dashboard (F8) | Inspect the top card after completing onboarding. | "You're all set. Pick the weekly shift that fits your life." Choose your weekly shift button. Active quick links available. No Training & paperwork, Approval or background-check text. |
| ONBN-02 | CHANGED | Locked until profile done | With required fields empty, visit /dashboard, /shifts, /my-shifts, /messages, /resources, and /profile. Then use a completed onboarding persona to visit /shifts. | Incomplete volunteers redirect to /onboarding; only onboarding and the agreement page permit incomplete profiles. Complete, not-active volunteers see why they cannot book yet. |
| ONBN-03 | CHANGED | Complete QA profile (F8) | Finish Volunteer · Onboarding, new; inspect detail and Notifications; reset afterwards. | Automatically Active with today's start date and Choose your weekly shift card. New shift welcome is suppressed for TEST account, never delivered. |
| ONBR-02 | CHANGED | Manual-case onboarding cannot book (F8, F12) | Open /shifts as Volunteer · Onboarding, ready to activate, with an open one-time shift at 375 px and desktop. POST sign-up/claim API. Repeat as Volunteer · Active and claim the shift. | "Your account isn't active yet. The Community Care Team will turn on shift sign-up for you. Questions? Contact the Community Care Team at cct@defendingthecause.org." No signup buttons or quick links; weekly sign-up API 403. One-time cards retain date, time, label and spots, with "You can claim one-time shifts once your account is active." (`text-one-time-not-active`); no `button-claim-custom-*` element exists. Active volunteers still see a working Claim button, then "You are signed up." with unchanged cancellation/contact behavior. Existing one-time claim API returns 422 with "Only active, verified volunteers can join this shift." for the onboarding persona (not 403); its rule is unchanged. |
| ONBR-03 | CHANGED | Profile page | Open /profile. | Editable: name, mobile, address, emergency contact. Read-only: email, DOB, status (Onboarding), start date (blank). No county, certification, background, or agreement fields. |

## Volunteer dashboard and profile

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ANS-01 | CHANGED | Choose-shift card | Click "Volunteer · Active, no shift". | "Choose your weekly shift" card with a primary button to /shifts. Quick-links row (Log in to Find Help, Open Phone Portal) opens each in a new tab. |
| ANS-08 | CHANGED | Next shift & upcoming | Look at the dashboard. | "Your next shift" shows day, date and time (e.g. "Tuesday, 10:00 AM–12:00 PM"). Upcoming list shows the next 4 occurrences. |
| ACT-02 | CHANGED | Layout & voice | Look over the dashboard at 375 px and desktop. | White branded top bar with navy rule, approved mark/horizontal assets; Home/My Shifts/Messages/Resources/Profile bottom tabs, blue active indication. Resource Coordinator role copy; current navy/blue/gray/white palette. |
| ACT-10 | CHANGED | Profile edits | On /profile, edit phone, address and emergency contact. Read the Email hint and find the Email address section below. Compare onboarding's hint. | Changes save. The read-only Email field says "To change your email, use Email address below." Self-service email changes require verification. Onboarding keeps its staff-contact hint. DOB, status and start date remain read-only. |

## Volunteer standing shifts

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ANS-02 | CHANGED | Counts only | Open /shifts on desktop and at 375 px. Inspect the network responses. | Week grid on desktop, day list on mobile. Each slot shows only "1 spot open" / "Full" / "Your shift". No other volunteer's name, email or phone anywhere, including API responses. |
| ANS-03 | CHANGED | Sign up | Sign up for Tue 10–12 starting the next Tuesday. (Also try picking a start date 3 weeks out.) | Confirmation screen and email (suppressed): "You're on the schedule: Tuesdays, 10:00 AM–12:00 PM, starting {date}." Start-date picker allows up to 4 weeks out. |
| ANS-04 | CHANGED | Overlap blocked | Try to add Tue 9–11 or Tue 11–1. | Blocked: "That time overlaps with your Tuesday 10:00 AM–12:00 PM shift." |
| ANS-05 | CHANGED | Can't drop only shift | Click Drop on the only shift. | Only standing shift cannot be dropped; Change shift offered, with public Community Care Team contact for stepping back. |
| ANS-06 | CHANGED | Change shift | Change to another open slot. | The old shift ends and the new one appears. The dashboard's next-shift card updates. |
| ANS-07 | CHANGED | Race for last spot | As admin, find (or make) a slot with exactly 1 open spot. Open it as ANS in browser A and ACT in browser B and click sign up at the same moment. | Exactly one wins. The other gets a friendly "just filled" message. The slot shows Full, never 3/2. |
| ACT-03 | CHANGED | Two-shift cap | Add a second non-overlapping standing shift, then try a third. | The second succeeds. The third is blocked with the max-2 message. |
| ACT-04 | CHANGED | Week off & undo | Take a week off on an occurrence more than 24 hours away, then Undo. Then try a week off on one less than 24 hours away (use ?at= in dev). | Week off/Undo removes/restores that occurrence. Inside 24 hours show public Community Care Team contact guidance, not a personal mailbox. |
| ACT-05 | CHANGED | Week off triggers coverage gap | Take a week off on an occurrence within the next 7 days (but more than 24 hours away) that leaves the slot under capacity. Then check ADM-13. | The master schedule shows this volunteer struck through with "week off", and one coverage-gap alert goes out (see ADM-13). |

## CCT grid, blocked dates and one-time shifts

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-06 | CHANGED | One-time shifts | After ADM-11, open /shifts → One-time shifts. Claim a spot. Try one that overlaps your own shift that day. Cancel one more than 24 hours away, then try one less than 24 hours away. Try to claim a full one. | Claim works and shows in the dashboard upcoming list with a One-time tag. It doesn't count toward the 2 standing shifts. The overlapping claim is blocked. Cancel works outside 24 hours and is blocked inside it (with contact note). A full one-time shift can't be claimed. |
| ADM-03 | CHANGED | Load standard grid | In Settings, confirm “Load Community Care Team standard grid” twice on the seeded grid. Repeat twice in an empty isolated development grid with no slots. | Seeded grid creates 0 then 0 because all 40 slots exist; empty grid creates 40 then 0. The editor deactivates rather than deletes slots. Deactivated slots still count as existing and are not recreated; reactivate them in the editor instead. |
| ADM-04 | CHANGED | Grid editor | Open a new slot and check capacity and default end time. Edit an existing slot with a different capacity. Add an overlapping slot. Try "Copy Monday to all weekdays" on a scratch setup. | New slots default to capacity 2, matching the standard grid. Existing slots retain their own capacity. Overlap shows an "overlaps with …" note, not an error. End time defaults to start + 2 hours. Copy fills the weekdays. |
| ADM-05 | CHANGED | Capacity & deactivation guards | Lower a slot's capacity below its assigned count. Deactivate a slot that has volunteers. | Capacity change is blocked with a clear message. Deactivation shows the assigned count and makes you choose keep-until-date or end now; end now emails each volunteer. |
| ADM-06 | CHANGED | Closed date | Add a closed date (next weekday, "Test closure"), check the schedule, then delete it. | Master schedule shows gray "Closed – Test closure". No occurrences, coverage warnings, or reminders that day. Deleting restores them. |
| ADM-08 | CHANGED | Admin overrides | From a block's side panel: assign a volunteer past capacity, assign one past the 2-shift cap, remove a volunteer, add and remove a week off. | Searchable active-volunteer list. Over-capacity and over-cap need the Override checkbox + reason. Remove offers an optional email. All actions appear in the activity log. |
| ADM-09 | CHANGED | Block a shift on a date | Side panel → "Block this shift on {date}" for next Tue 10–12, reason required, email checkbox on. Then Unblock. | Shows gray "Blocked – {reason}". Assigned volunteers get "No shift on {weekday, date} — {reason}. Your regular shift continues the following week." The occurrence drops out of coverage, alerts, digest, on-shift-now/up-next and reminders. Unblock restores it. |
| ADM-10 | CHANGED | Block a range | Settings → Block shifts: a 2-day range with two selected slots, then a range with "all shifts". | Exactly those occurrences are blocked. |
| ADM-11 | CHANGED | Create one-time shift | Master schedule → "+ Add a one-time shift" (label, capacity 2, open to volunteers on). Assign one volunteer directly, then try a third past capacity. | Dashed blue border and "One-time" tag. It shows on /shifts for active volunteers (ACT-06). Exceeding capacity needs Override + reason, logged in activity. |
| ADM-12 | CHANGED | Cancel one-time shift | Cancel a one-time shift that has volunteers. | Confirm dialog, assigned volunteers are emailed, and it disappears from the schedule. |

## Coordinator dispatch and master schedule

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-02 | CHANGED | On shift now / Up next | On admin home, use ?at= in dev: a Tuesday at 10:30 AM, a time during hours with an empty slot, and 8:00 PM. | 10:30: two groups (9–11 and 10–12), each with its own end time, names, tap-to-call phone and email. Empty slot: amber "No one is on shift right now". 8 PM: "Outside shift hours". Up next, "Updated h:mm AM" refreshing every 60 s, coverage summary, needs-attention count and recent activity all show. Test accounts carry the TEST badge. |
| ADM-07 | CHANGED | Master schedule view | Open /admin/schedule on desktop and at 375 px. Use week navigation and Today. | Two lanes per day on a 30-minute grid; every block readable. Blocks show time, "2/2", first name + last initial. Full = white with blue accent; under capacity = gray with amber "1 open"; empty = soft amber "Open". Today highlighted. Mobile shows a day list with a day picker. |

| ADM-38 | CHANGED | Admin schedule — future standing assignments | Give an Active persona a standing shift starting 15 or more days out. Open its Master schedule side panel and try marking a week off before the start date through the API. Check the volunteer’s own out-of-period week-off action. Reset test accounts afterwards. | Only dates on or after the assignment start, plus stored future weeks off, are listed; earlier dates have no “Mark week off” action. The API returns 422 with “That date is before this volunteer's standing shift starts.” The volunteer action rejects out-of-period dates the same way. |

## Staff roster and CSV exports

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-18 | CHANGED | Roster defaults | Open /admin/volunteers. Toggle "Show test accounts". | Default contact/city/start/shifts/login columns; No shift amber. QA hidden by default; Show test accounts reveals four volunteer profiles (fifth persona is the admin on Team). Summary chips exclude QA either way. |
| ADM-19 | CHANGED | Columns, sort, layout | Use the Columns picker to show DOB, full address, ZIP, emergency contact, county. Reload. Sort by several columns. Check desktop and mobile. | Picker choice survives reload. Sorting works on every column. Sticky header and first column on desktop; stacked cards on mobile. |
| ADM-20 | CHANGED | Filters & chips (F8) | Combine status/city/county/Needs attention with Background check Complete or Not recorded. Try all attention reasons and export both CSVs. | Correct intersections. Label "Not active yet" keeps awaiting_review key; 7-/30-day reasons unchanged. Background filter applies to both CSVs, adds no attention reason. Summary chips unchanged. Optional sortable background column is off by default. |
| ADM-21 | CHANGED | CSV exports (F8) | Export roster and schedule with background and attention filters; open in Sheets. | Dated files, matching real volunteers only. Roster retains profile columns plus Background check complete Yes/No and Background check date YYYY-MM-DD/blank. No certification/agreement columns. Schedule format unchanged, including one-time assignments/skips. |

## Volunteer detail and status workflow

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ONBR-04 | CHANGED | Activated by admin | Keep this signed in on device A. On device B, do ADM-22. Refresh device A. | Top card becomes "Choose your weekly shift", quick links appear, and the approval email ("You're approved! Choose your weekly shift") is logged as `suppressed`. |
| ADM-22 | CHANGED | Manual activation (F8) | Open ready-to-activate persona. Read Activation/Ready to activate; Approve as Active and confirm. Move back to Onboarding, clear start date, approve again. Repeat with an existing start date. | No compliance gate. Every activation fills a missing date with Pacific today, even previously Active; existing date retained. Staff actor/activity logs and manual approval email unchanged, suppressed for TEST. Roster and overview refresh. |
| ADM-23 | CHANGED | Incomplete activation blocked (F8) | Open new persona before completion; inspect Activation checklist and attempt approval through API. | Missing profile/onboarding/verification requirements listed with guidance. Approve as Active unavailable; API 422 with missing items, no override. Staff-only background checkbox is not a requirement. |
| ADM-24 | CHANGED | Volunteer detail (F8) | Edit start date alone/with private fields, DOB, emergency contact, county and notes; inspect Activity and background card. | Start-date edit logged separately; private/tracking edits log names only. DOB must be at least 18 years ago. Staff-only background record card present; no certification/agreement cards. County staff-only; notes autosave. |
| ADM-25 | CHANGED | Inactivate releases shifts | Move Volunteer · Active to Inactive. Without reloading, inspect Current shifts, Standing shifts and dates, and the master schedule. Then Reset test accounts. | Confirm dialog lists the shifts being released. Assignments end today. Both shift lists clear immediately, with no stale Mark week off buttons, and the master week refreshes. A coverage-gap alert goes to real admins. The persona's dashboard shows the gentle inactive note. Reset restores it. |

## Roles and staff administration

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-26 | CHANGED | Invite admin | Team → Invite admin with an address you control. Open the invite link and set a password. | Lands on /admin already verified. |
| ADM-27 | CHANGED | Deactivate / reactivate | Deactivate the NEW account while it's signed in elsewhere. Try to sign in as it. Reactivate. Then try to deactivate yourself, and the last active admin (in dev). | Its open session is signed out on the next request. Sign-in shows "Your account isn't active. Please contact The Alliance." Reactivate restores access. Self-deactivation and last-admin deactivation are both blocked. |

## Messaging

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-07 | CHANGED | Inbox | After ADM-16 sends this persona a single message, open /messages. | Unread dot/nav badge; opening marks read and updates staff receipts; markdown renders. No reply box; Questions guidance names the Community Care Team mailbox. |
| ADM-16 | CHANGED | Messaging | New message → All active volunteers, email on. Check the preview count, send. Then send a single message to Volunteer · Active. After ACT-07, reopen the sent list. | Preview count excludes test accounts and inactive volunteers. One notification_log row per recipient; the test persona's row is `suppressed`. Sent list shows "N of M read" and per-recipient receipts update after ACT reads. |
| ADM-17 | CHANGED | Message selected | Roster → select 3 volunteers → Message selected. | Composer opens with exactly those recipients. |

## Reminders and coverage alerts

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-12 | CHANGED | Job runner | In development, set `RUN_JOBS=true`, watch for a 15-minute scheduler run, then restore it. Call POST /api/jobs/run without `X-Jobs-Secret`, then with `X-Jobs-Secret` containing the JOBS_SECRET value; also try a differently named header such as JOBS_SECRET. | The scheduler logs runs every 15 minutes only when RUN_JOBS=true. Missing header returns 401/403; the correct header returns 200 and runs the job. X-Jobs-Secret is the only accepted header; a secret sent under any other header name is refused. |
| ACT-13 | CHANGED | Reminder de-dupe for test account | After ADM-15, check this persona's reminder rows in the notification log. | One `suppressed` reminder row. Running the reminder check again adds no second row. (If it does, suppressed rows aren't counted by the de-dupe check: report it as a bug.) |
| ADM-13 | CHANGED | Coverage-gap alert | After ACT-05, filter the notification log by type admin_alert. | Exactly one alert per real admin (e.g. admin@example.org): "Coverage gap: {Tue Oct …}, 10:00–12:00 now has 1 of 2 volunteers (Test A. took the week off)." with a button to that week. No row for qa-admin@example.org. |
| ADM-14 | CHANGED | Daily digest | With the digest toggle on and a gap in the next 7 days, trigger the digest twice the same day (job endpoint or Run now). Then remove all gaps and trigger. Then turn the toggle off and trigger. | One digest per real admin for the day (relatedId = date); none to the test admin. Nothing sent when there are no gaps, or when the toggle is off. |
| ADM-15 | CHANGED | Reminders | With external delivery disabled in isolated development, create a one-time shift starting within the next 24 hours, e.g. 3 hours from now. Assign ACT and a seeded non-test dummy volunteer. At /admin/notifications/jobs run the reminder check twice. As the ordinary dev admin (admin@example.org, not Test Admin), click “Send test reminder to me”. | Catch-up produces one reminder per assigned volunteer, logged for the dummy and suppressed for ACT; subject reflects tomorrow or today’s date, with quick-link buttons and the week-off line. The second check sends nothing new. Week-off, blocked and closed-date occurrences receive none. Last-run time and the 7-day count update. The ordinary admin’s test reminder is logged; Test Admin’s would be suppressed. |

## Email identity and notification monitoring

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-09 | CHANGED | Email template (log mode) | With no POSTMARK_SERVER_TOKEN in isolated development, send a test email to a non-test address via the dev test route or Admin → Notifications → Send test email. Do not use a TEST recipient to prove logged delivery. | The console prints the email and notification_log records status logged. From is `"The Alliance Community Care Team" <cct@defendingthecause.org>`; Reply-To uses EMAIL_REPLY_TO if set, otherwise the sender address. White header with APP_BASE_URL/brand/logo-horizontal.png over a 4px navy rule, blue CTA, Community Care Team contact/footer, mission line, and “You're receiving this because you serve with The Alliance Community Care Team.” No Cindi mention; plain text included. |
| SYS-10 | NEW; CHANGED | EMAIL_FROM / EMAIL_REPLY_TO | In an isolated local setup with external delivery disabled, set EMAIL_FROM to a malformed value and start with NODE_ENV=production, then try a send in development. Restore it. Set EMAIL_REPLY_TO to another address and send a test email, then unset EMAIL_REPLY_TO. | Production-mode startup refuses malformed EMAIL_FROM with a clear error naming the secret. Development startup does not perform that check, but sending is clearly refused. Explicit EMAIL_REPLY_TO is used; when unset, Reply-To falls back to the sender address (cct@defendingthecause.org). Restore all temporary settings. |
| ADM-28 | CHANGED | Notification log & monthly count | Open /admin/notifications. Compare the month count with the log filtered to sent + logged. Use filters and search. Retry a failed row. Set the monthly limit so the next send crosses 80%, send twice, then restore 100. | Count equals sent + logged (suppressed excluded), with a by-type breakdown and 6-month chart. Filters and search work; Retry resends. Crossing 80% sends one "Heads up" email to real admins; the second send doesn't repeat it. |
| ADM-29 | CHANGED | Postmark card | Inspect Postmark card in dev without provider; use an ordinary isolated admin for a logged test email. | Configured From/name/address, Reply-To, token status and DKIM/Return-Path guidance. TEST recipients produce suppressed rows, not real mail. |

## Resource hub

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-08 | CHANGED | Resource hub | Open /resources. Search, filter, open an article, and download a valid document. Try a missing/unreadable document or legacy seed placeholder in production; inspect it as staff and replace its file. | Published valid documents download through authenticated routes. Missing/unreadable files return 404 with “This document isn't available right now.” Staff see “File missing — replace it”; replacement keeps the resource record and removes the warning. No production local seed upgrade is attempted. Unpublished items stay hidden. |
| ACT-09 | CHANGED | Downloads need sign-in | Copy a document download URL, sign out (or use a private window) and open it. | Refused (401 or sent to sign-in). Not a public URL. |
| ADM-30 | CHANGED | Resource admin | Upload a PDF and a DOCX; try a &gt;15 MB file and a .exe. Replace a file. Write an article with live preview. Add a quick link with http:// then https://. Drag to reorder and reload. Unpublish one item. | PDF/DOCX upload; oversized and wrong-type files rejected. Replace keeps the same record. http link rejected, https accepted. Order persists. Unpublished item hidden from volunteers (ACT-08). Category autocomplete works. |
| ADM-31 | CHANGED | Agreement re-ack stays off | If an agreement-version bump option shows, bump it. Sign in as Volunteer · Active. | No re-acknowledgment prompt for volunteers while requireAgreementAcknowledgment is false. |

## Quick login and synthetic QA accounts

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-11 | CHANGED | Test accounts exist once | Restart development twice, then query users with isTestAccount = true and count their matching volunteer profiles. | Exactly 5 flagged users: qa-admin@example.org plus 4 volunteer personas; exactly 4 matching volunteer profiles, because the test admin has none. No duplicate or orphaned old vol-training / vol-applicant users. |
| VIS-03 | CHANGED | Quick-login card (dev) | Look below the sign-in card in development. | Amber dashed “Quick login — testing” card in sentence case, with 5 buttons: Admin; Volunteer · Active; Volunteer · Active, no shift; Volunteer · Onboarding, ready to activate; Volunteer · Onboarding, new. One column at 375px and at least 44px targets. No button mentions training, certification or applicant. |
| ONBN-01 | CHANGED | Quick login | Click "Volunteer · Onboarding, new". | Lands on /onboarding. Amber banner: "You're signed in as a TEST account (Volunteer · Onboarding, new). Emails to this account are not sent." The banner pushes content down and doesn't cover the top bar or bottom tabs. |
| ONBN-04 | CHANGED | Reset restores persona | As admin, Team → Reset test accounts. Quick-login as this persona again. | Profile fields are empty again and it lands on /onboarding. |
| ONBR-01 | CHANGED | Manual-case quick login (F8) | Click Volunteer · Onboarding, ready to activate. | Dashboard shows Account created ✓ and Profile complete ✓ only, with Community Care Team shift-signup guidance. No Training & paperwork or Approval rows. |
| ACT-01 | CHANGED | Quick login & banner | After Reset test accounts, click "Volunteer · Active". Use Switch account in the banner, then Sign out. | Dashboard shows "Your next shift" for its one seeded shift. Switch account lists the other 4 personas and one click switches. Sign out returns to /signin. |
| ADM-01 | CHANGED | Quick login (F9, F11) | Click "Admin", then open the hamburger menu on a phone. | Lands on /admin with the TEST banner. The sheet lists all 11 current admin pages, including Reports after Volunteers and My Profile, with every item reachable by scrolling; Resources is last. See ADM-41. |
| ADM-32 | CHANGED | Reset test accounts (F10, F13) | Log hours and create a calendar link for a QA persona; retain separate non-test fixtures with hours and a feed. Team → Test accounts → Reset (confirm). Fetch the old QA URL. | Still exactly 5 QA accounts. QA hours and calendar_feeds rows are deleted in the same reset transaction, before referenced schedule data; old QA URL returns 404 and a new link is created on the next calendar-info request. QA profile/shift/inbox defaults return and one-time claims are cancelled. Reset is audited and test sessions end. Non-test hours, calendar feeds and all other real records are unchanged. |
| ADM-33 | CHANGED | TEST badges on one-time claims | After ACT-06, look at the one-time shift on the master schedule, its side panel, and the roster. | The test persona has the gray TEST badge in all three places. |

## Security, privacy and mobile accessibility

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-11 | CHANGED | Admin APIs blocked | From devtools, call several /api/admin/* routes. Visit /admin. | Every API returns 403. /admin redirects to /dashboard. |
| ACT-12 | CHANGED | Privacy in responses | Inspect network responses on /dashboard, /shifts, /messages and /resources. | No other volunteer's name, email or phone. No adminNotes. No DOB, address or emergency contact for anyone except yourself. |
| ACT-14 | CHANGED | Phone & tablet walk | Walk every volunteer screen at 375 px and 768 px. | No horizontal scrolling. Tap targets at least 44 px. Dashboard usable one-handed. Every page uses the same page header (title, subtitle, actions); long titles and actions wrap cleanly at 375 px. |
| ADM-34 | CHANGED | Phone & tablet walk (F11) | Walk every admin screen at 375 px and 768 px, including Reports. Check desktop navigation at 1280, 1440 and 1920 px. | No horizontal scrolling. Tables become cards; Reports tiles stack and volunteer hours become cards at 375 px. On shift now is usable one-handed. Every admin page uses the same page header; actions wrap under the title on narrow screens. Desktop admin navigation fits on one line; My Profile is available in the user menu instead of a duplicate top-bar link, and remains in the phone sheet. |

## Production readiness and operation

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-06 | CHANGED | Schema is additive (F10, F13) | Diff shared/schema.ts against the last published version and review Publish's proposed diff. | Fix 13 adds only calendar_feeds: UUID PK, unique profile FK with cascade, unique token hash, encrypted token, timestamps, nullable client text with CHECK; no existing column/table/enum changes in this fix. Prior changes retained: volunteer_hours and account archiving's nullable users.archived_at. No new pg enum type. Publish manages schema; reference SQL never runs at boot. |
| SYS-13 | CHANGED | Production-mode lockdown | Use the isolated production-mode harness, with synthetic data and no live delivery, to check seed refusal, dev-route/time-override lockdown and production quick-login enable/disable. | Seed refuses production; development-only routes/overrides disabled. Quick login depends only on the production switch; normal protected-route guards remain. |
| SYS-14 | NEW | Health route | GET /api/health. | Returns database and email-config status with no secret values. |
| PRD-01 | NEW | Enum value before publish | Before publishing Prompt 22's schema, run `ALTER TYPE volunteer_status ADD VALUE IF NOT EXISTS 'onboarding';` in the production Database tool. | Runs without error. |
| PRD-02 | NEW | Publish change list | Publish and read the schema change list. | Only additive changes. If anything is dropped, renamed or converted, choose Cancel deployment. Never "Copy your development database schema & data to production". |
| PRD-03 | NEW; CHANGED | Status update | Operator-approved one-time step, completed Oct 11 after the Prompt 22 publish: run `SELECT status, count(*) FROM volunteer_profiles GROUP BY status;`. If legacy applicant / in_training rows appear, ask before running the master’s UPDATE to onboarding. Do not run production SQL during this documentation sync. | No applicant / in_training rows. Read-time normalization treats any legacy rows as onboarding, so the app continues working while separate approval for a backfill is pending. |
| PRD-04 | NEW | Health & clean data | GET /api/health. Check users for admin@example.org or dummy volunteers. | Health OK. No seed data. The only @example.org users are the 5 qa-* test accounts. |
| PRD-05 | NEW; CHANGED | Grid in production | Click “Load Community Care Team standard grid” once, then once more. | The first click creates only missing standard slots: 20 after the Fix 1 purge that retained 4 existing times, or 40 on an empty grid. Deactivated slots count as existing and are not recreated. The second click creates none. |
| PRD-06 | NEW; CHANGED | Live test email and reminder | In production as a normal verified admin, open Admin → Notifications and click "Send test email to me"; open Reminder jobs and click "Send test reminder to me". Inspect delivery and logs. Repeat with TEST admin; try either route anonymously or as a volunteer, and with a recipient override. | Both buttons are visible in production and send only to the signed-in admin. Normal sends use the configured CCT identity and log sent; TEST sends log suppressed and deliver nothing. Anonymous/volunteer access and recipient overrides are rejected; CSRF remains required. Logo and configured Reply-To/fallback render, token is configured, DKIM/Return-Path verified. |
| PRD-07 | CHANGED | Quick login on, no unlock | With `QUICK_LOGIN_ENABLED=true` in Secrets (republished), open /signin in a fresh private window. | Testing card appears immediately with test-account and production pills and all five buttons; no device-specific access action. |
| PRD-08 | CHANGED | Old unlock routes gone | Visit retired testing entry points described in master PRD-08 without sharing credentials; return to /signin. | Normal not-found page, no session/device-unlock action. Enabled quick login is independent of those URLs. |
| PRD-09 | CHANGED | All 5 personas | Sign in as each persona. | Admin → /admin. Active → next-shift card (or choose-shift if it has none). Active, no shift → choose-shift card. Onboarding, ready → dashboard checklist. Onboarding, new → /onboarding. |
| PRD-10 | CHANGED | Reset after prod testing | If any persona took a shift, Team → Reset test accounts. Check the master schedule. | Prod Volunteer · Active starts with no shift after reset, and any capacity used in testing is freed. |
| PRD-11 | CHANGED | Turn quick login off | When prod testing is done (and before the first pilot invites): set `QUICK_LOGIN_ENABLED=false`, republish, open /signin in a fresh window, and call GET /api/auth/quick-login/status. | No quick-login card. The status call returns 404. Normal sign-in still works. |
| PRD-12 | CHANGED | External cron | Watch Admin → Reminder jobs for 30+ minutes; click Run reminder check now once. On a weekday after 7 AM, check Schedule settings → Last daily check and the notification log. | Green Scheduled runs are on time notice updates every 15 minutes with a time under 15 minutes old. Scheduler says cron-job.org (outside service), every 15 minutes in green; source is Scheduled (cron-job.org). Manual click shows Manual (Run reminder check now); Last scheduled run still shows the external run and health stays green. Weekday daily check runs after 7 AM and sends/logs the digest if gaps exist; No daily check yet over a weekend is expected. External POST uses X-Jobs-Secret and {}; production timer stays disabled. Budget, catch-up, dedupe and uncertain-delivery protections are unchanged. |
| PRD-13 | CHANGED | Production lockdown | Restart logs; open /style-guide; add ?at= to admin home. | Startup secrets check passes. /style-guide is 404. ?at= is ignored. |
| PRD-14 | NEW | Seed data purge | Separately authorized production operation only: after a real admin exists, run the Fix 1 pre-checks, numbered statements in order, and post-checks in the production Database tool. Inspect roster with test accounts off/on, master schedule, email log and /resources; quick-login as all 5 personas. Do not execute this purge during documentation sync. | Pre-checks show at least 1 active admin outside example.org, 19 users to delete and 5 qa-* users. Every statement succeeds. Post-checks show 0 non-test @example.org users, profiles, assignments, messages, resources and notification rows; 5 qa-* users remain and shift_slots are unchanged. Roster contains only test personas, schedule has no names, email log has no dummy rows, /resources is empty, and all 5 quick logins work. |

## Milestones — Optional: only if Prompt 27 / 28 is built

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| MIL-01 | NEW Optional: only if Prompt 27 / 28 is built. | Upcoming milestones card | Edit a dummy volunteer's DOB to 10 days from now and another's start date to N years ago, within 30 days. Open admin home. | "Upcoming milestones" shows the birthday as month/day only (no year or age) and "N years with the Community Care Team", each linking to the volunteer. |
| MIL-02 | NEW Optional: only if Prompt 27 / 28 is built. | Roster filter | Roster → "Milestone this month". | Shows only volunteers with a birthday or anniversary this month. |
| MIL-03 | NEW Optional: only if Prompt 27 / 28 is built. | Monday email | Trigger the milestone job as Monday 7:00 AM (?at= or job endpoint) twice. Then with no milestones. Then with the toggle off. | One email to real admins for the week (relatedId = ISO week); the rerun sends nothing. Nothing when empty or toggled off. |
| MIL-04 | NEW Optional: only if Prompt 27 / 28 is built. | Edge cases | Inactivate a volunteer with a milestone. Run `npm test`. | Inactive volunteers drop off. Date-math tests pass, including Feb 29 → Feb 28 in non-leap years. |
| MIL-05 | NEW Optional: only if Prompt 27 / 28 is built. | Test accounts in milestones | Look for the test personas (DOB 1990-01-01) in milestones. | Not specified in Prompt 27. Decide: hidden, or shown with a TEST badge. Log what you see. |

## Notification preferences — Optional: only if Prompt 27 / 28 is built

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| NTF-01 | NEW Optional: only if Prompt 27 / 28 is built. | Preferences UI | Open the admin notification preferences. | Three events (standing shift sign-up, shift change, one-time claim/cancel), each Off / Instant / Daily summary, defaulting to Daily summary. |
| NTF-02 | NEW Optional: only if Prompt 27 / 28 is built. | Instant emails | Set the seeded dev admin to Instant for all. As ANS, sign up, change a shift, and claim and cancel a one-time shift. | One email per event to that admin. |
| NTF-03 | NEW Optional: only if Prompt 27 / 28 is built. | Daily summary | Set to Daily. Trigger the 5:00 PM job twice. Then on a day with no activity. Then set Off. | One summary for the day (relatedId = date); nothing on an empty day or when Off. |
| NTF-04 | NEW Optional: only if Prompt 27 / 28 is built. | Nothing else changed | Repeat ACT-05. | The coverage-gap alert still behaves as in ADM-13. Nothing is sent to the test admin. |

## Retained checks with no exact matching master ID

These earlier checklist checks go beyond an exact persona-plan case. They remain useful release checks, but do not count as additional master coverage.

| Local ID | Master ID | Steps | Expected result |
|---|---|---|---|
| AUTH-06 | No exact match | Use “Wrong email? Start over”; register with corrected email. | Fresh signup state; no stale verification address. |
| AUTH-12 | No exact match | Sign out; refresh/back/open protected link. | No cached protected view; sign-in required. |
| AUTH-13 | No exact match | Attempt Google sign-in if configured. | Only enable acceptance testing after deferred Google setup is completed; no silent password-auth regression. |
| TEAM-02 | No exact match | Reuse, expire or alter an invite link. | Rejected without account takeover. |
| TEAM-05 | No exact match | In a safe setup environment, run `npm run create-admin -- email@domain.org "First" "Last"`. | Creates pending admin and invite link, not an immediately usable default password. Treat the link as confidential. |
| PROF-03 | No exact match | Change password with wrong/current password; check validation and other sessions. | Wrong password blocked; success invalidates old sessions and returns to sign-in with confirmation. |
| SHIFT-01 | No exact match | `/shifts`: book available standing slot with default and chosen start within four weeks. | Own shift/count-only grid; correct repeat/start date and confirmation email. |
| SHIFT-05 | No exact match | Drop one of two shifts; then attempt dropping only remaining shift. | Allowed drop ends assignment; last-shift drop blocked with change/contact option. |
| GRID-03 | No exact match | Copy Monday to all weekdays. | Fast setup without accidental duplicate/overlapping-coverage corruption. |
| COORD-02 | No exact match | Wait one refresh cycle; simulate fetch failure. | Updated time refreshes each minute; stale schedule never presented as current dispatch information. |
| MSG-02 | No exact match | Preview bold/links/lists and HTML/script-like input; toggle email off/on. | Safe markdown rendering; inbox always created; email only when enabled, branded with portal link. |
| MSG-03 | No exact match | Repeat same send/retry and exceed send rate using synthetic recipient. | Idempotent recipients; no duplicate email; staff/IP send limits enforced. |
| EMAIL-02 | No exact match | In isolated production-mode email tests, omit delivery settings and attempt a recovery email. | Fails closed and records failure; no console recovery links/tokens and no live delivery. |
| EMAIL-03 | No exact match | In approved email test environment, test provider success/failure and duplicate related ID. | `sent` + provider ID or `failed` + safe error; same recipient/type/related ID not resent; outbound stream. |
| RES-03 | No exact match | Try &gt;15MB, fake extension/signature, malformed/traversal/macro DOCX and unsafe filename. | Rejected/safely named; no publicly executable content or invalid resource record. |
| RES-05 | No exact match | Create HTTP/javascript/credential-bearing link URL. | Rejected; HTTPS-only links accepted. |
| SEC-02 | No exact match | Submit arrays/null/unknown privileged fields, invalid IDs/dates and malformed JSON to writes. | Zod/domain validation; consistent `{error, code}`; no mass assignment; no stack traces. |
| SEC-03 | No exact match | Send mutations with missing/foreign Origin and missing/incorrect CSRF token; then correct pair. | Invalid pairs rejected; valid pair works; secret-authenticated job route is intentional exception. |
| SEC-04 | No exact match | Inspect API headers and production session cookie. | Helmet headers, no exposed framework header; httpOnly/secure/SameSite=lax; private APIs no-store. |
| TIME-02 | No exact match | Use UTC and New York browser zones; inspect login/activity/job/notification timestamps and schedule/date-only profile fields. | Operational dates/times use America/Los_Angeles; DOB/start date remain the same calendar date in every browser zone. |
| UI-02 | No exact match | Navigate all forms/tabs/dialogs/schedule using keyboard; Escape, focus return, submit errors. | Visible focus; correct labels, focus trap/return; meaningful announced errors/toasts; no keyboard trap. |
| UI-03 | No exact match | Check contrast, zoom 200%, ≥44px targets, long names/text and empty/loading/error states. | WCAG AA-oriented styling remains usable; warm, specific copy without stigmatizing family language. |

## Fix 2 — production regression workflows

| Test ID | Tag | Workflow | Steps | Expected result |
| --- | --- | --- | --- | --- |
| ADM-35 | CHANGED | Cross-role quick login | Sign in as Volunteer · Active. Use the banner to switch to Admin, back to Volunteer · Active, and to Admin again. Repeat with the app mounted beneath a base path. | Each switch lands at the returned dashboard/admin URL with the correct persona banner. No stuck spinner or stale volunteer/admin data. |
| ACT-15 | CHANGED | Dashboard contrast | View completed onboarding/not-active, active/no-shift, and active/with-shift dashboards. Run the automated axe color-contrast checks. Also inspect shift confirmation on its navy card. | Display headings, next-shift date and labels are white on navy; all three dashboard contrast checks pass. |
| ADM-36 | CHANGED | Shift notification classification | Book/change a standing shift, take a week off, claim/cancel a one-time shift, and apply an admin removal/block/cancellation. Inspect the log, filter by Shift, and review monthly totals and the six-month chart. | Those emails are labeled Shift, not Welcome. Genuine welcome and approval emails remain Welcome; reminders and admin coverage alerts retain their own types. Historical rows are not rewritten. |

## Fix 3 — UI and copy polish

| Test ID | Tag | Workflow | Steps | Expected result |
| --- | --- | --- | --- | --- |
| VIS-08 | CHANGED | Sign-in and install metadata | Sign in with googleEnabled false, then true when configured. Inspect /manifest.json response headers and body, including after Publish. | Disabled Google button and its “or” divider are hidden, without removing Google code. Enabled Google remains available. Manifest is valid JSON with Content-Type application/json (an optional charset is fine), not the index.html fallback. |
| ADM-37 | CHANGED | My Shifts dates and displayed phones | View a standing shift starting in the future, then a past start date. Inspect displayed mobile/emergency numbers, including On shift now and the schedule side panel. | Future dates say “Starts”; past dates say “Started”. Ten-digit US phones display as (XXX) XXX-XXXX; tap-to-call remains available. |
| ADM-37 | CHANGED | QA persona labels | Inspect both Active personas on the master schedule, its side panel, On shift now, Team → Test accounts and message recipient search. | Schedule surfaces distinguish “Test · Active” and “Test · Active, no shift”, keeping gray TEST badges. Team uses the same shared persona labels as sign-in. Test recipients have TEST badges. |
| ADM-37 | CHANGED | Weekend default week | On Saturday and Sunday (also DST weekends), open the master schedule with no week parameter and press Today after navigating away. Check admin-home This week stats. Select a previous week explicitly. | Default/Today and overview stats use the coming Monday–Friday week. Explicit previous-week selection still works; live On shift now logic is unchanged. |
| ADM-37 | CHANGED | Staff Profile and capacity guidance | Click each Profile-card label and inspect htmlFor/id associations. Edit slots with 1 and 2 assignments. | Each label focuses its own control. Helpers say “1 volunteer is assigned, so capacity can't go below 1.” / “2 volunteers are assigned, so capacity can't go below 2.” Server capacity errors use the same singular/plural grammar. Capacity enforcement is unchanged. |

## Master/app disagreements (resolved Oct 12)

**CHANGED:** The user’s Oct 12 master resolves the 13 earlier assessments retained below. No master or app edits were made during this sync. SYS-08 is an explicitly accepted limit, not a newly implemented roster feature; MIL/NTF remain optional and unbuilt.

| Master ID(s) | Original difference / assessment | Resolution |
|---|---|---|
| SYS-05, SYS-17 | Master assumes client/server/shared-schema locations and whole-workspace zero hits. Actual paths are artifacts/... and lib/db; historical migrations, the unchanged master, deliberate identity aliases and registered Canvas scaffolding require exclusions. | Master now uses artifacts/, shared/ and lib/db paths with the same dependency, build, migration, docs and Canvas exclusions; compatibility hits are reviewed and explained. |
| SYS-01, SYS-11 | Ordinary seed counts exclude the additional five QA identities. User rows and volunteer-profile rows are not interchangeable. | Master now separates the seed’s 1 admin / 18 volunteers from the 5 QA users and distinguishes users from volunteer profiles: QA users = 5, QA volunteer profiles = 4. |
| SYS-07, SYS-09, SYS-10, ANS-05, ACT-04, ACT-07, PRD-06 | Master expects personal Cindi contact/Reply-To/footer fields. Current app uses public Community Care Team contact; Reply-To uses explicit EMAIL_REPLY_TO or configured sender fallback. Dev rejects malformed identity at send; startup checks are production-only. | The master already used the Community Care Team contact as of Oct 11; that earlier assessment was outdated. SYS-09/SYS-10 now explicitly state sender-address Reply-To fallback and production-only EMAIL_FROM startup validation; development refuses malformed identity at send. |
| SYS-08 | Master promises flag restoration of roster badges/filters. The v2 roster has removed those controls; retained detail/CSV behavior is only partial compatibility. Known gap, not a passed master test. | Accepted C8 limit: only the detail card and CSV column return with the flag, not the roster badge/filter. Tracking remains off; adding roster controls if tracking is enabled would require a change order. The master now tests this accepted behavior. |
| SYS-12 | Master names an alternate machine header. Only X-Jobs-Secret is accepted. The environment variable is not an accepted header name. | Master now names X-Jobs-Secret as the only accepted header; other names, including JOBS_SECRET, are refused. |
| VIS-03 | Master quotes uppercase card/pill text; current CCT brand uses sentence-case testing labels. | Master now expects sentence case: “Quick login — testing”. |
| NEW-01 | Master treats a nine-character password as too short; actual minimum is eight. The negative test uses seven characters. | Master now tests rejection of a 7-character password and successful signup with 8 or more characters. |
| ADM-03 | Master asks to delete two slots in the editor; current editor offers deactivation, not deletion. Idempotence is checked with the seeded grid and an empty isolated grid. | Master now checks seeded-grid results of 0 then 0 and empty isolated-grid results of 40 then 0; deactivated slots count as existing and are not recreated. |
| ADM-15 | Master expects a future 24h–24h15m reminder and test-admin delivery. Current catch-up selects already-due reminders (within next 24h); TEST mail is suppressed. Use an ordinary synthetic admin in an isolated dev scope for logged delivery. | Master now uses a shift within the next 24 hours, a non-test volunteer, and an ordinary dev admin for logged delivery; ACT/Test Admin mail is suppressed and reruns send nothing new. |
| ADM-18 | Master expects five entries in the volunteer roster; four are volunteers and the fifth is the admin in Team. | The master already expected 4 volunteer personas in the roster, with the test admin on Team; no master change was needed. |
| PRD-03 | Master makes a production backfill unconditional. Current policy requires separate operator approval; read normalization works without it. No production update was performed. | Master now makes the one-time backfill operator-approved and records completion on Oct 11; read normalization remains safe while waiting for approval. No production SQL was run during this sync. |
| PRD-05 | Loader creates 40 only on an empty grid, not a previously configured one. | Master now says the loader fills only missing slots; deactivated slots are not recreated. It creates 20 after the Fix 1 purge that kept 4 times, or 40 on an empty grid, then 0 on rerun. |
| MIL-*, NTF-* | Future feature checks remain conditional; checklist coverage does not claim those features exist. | Unchanged: optional only if Prompt 27 / 28 is built; neither feature is built. |

## F8 — Oct 13 decisions / v1.2.0

The CHANGED workflows above cover SYS-04, SYS-07, SYS-08, SYS-18, NEW-10, NEW-11, ONBN-03, ONBR-01, ONBR-02, ADM-20, ADM-21, ADM-22, ADM-23 and ADM-24.

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| NEW-14 | NEW | Minimum age 18 | Onboarding: try a DOB one day short of 18, then exactly 18 today. Repeat via PATCH /api/onboarding and staff DOB edits. | Under-18 refused; onboarding names 18 and Community Care Team contact. Staff message: Date of birth must be at least 18 years ago. Exactly 18 accepted. Hint retains staff-only privacy wording. QA default DOB stays 1990-01-01. |
| ADM-40 | NEW | Staff-only background record | Tick Background check complete, try no date/invalid/future date, then today/past date; save and reload. Combine Complete/Not recorded with other roster filters; enable optional column and sort; export both CSVs. Untick and save; reset QA accounts. | Invalid completion refused with date guidance; save uses revision check and retains conflict draft. Column shows Complete · date/Not recorded; CSV includes Yes/No and calendar date/blank. Untick clears date. Volunteers/API responses/emails show no background data, status/shifts unaffected, no attention reason. Reset clears TEST records only; submitted date unchanged. Audit stores field names, never values. |
| PRD-15 | NEW | Production v1.2.0 — operator only | Publish and inspect schema list; reset QA. Finish new persona after rejecting under-18 DOB. Save/filter/clear background on Active persona; manually approve ready persona, reset again. | No schema changes. New persona auto-activates with today's missing start date and one suppressed shift welcome. Staff record works; manual approval fills missing start date. Reset restores all defaults including background record. Do not load real volunteer fixtures. |
| PRD-16 | NEW | Official address — operator only | After matching APP_BASE_URL/APP_ORIGIN to official custom domain and republishing, open old .replit.app /signin plus verification/reset/invite links with query/hash. Test sign-in and a reversible TEST note edit on official domain; send own test email; check external cron and jobs page. | Old links land on same path/query/hash at official domain; matching origin, development and .replit.dev never redirect. HTTPS/sign-in/CSRF saves work. Email logo/links use official address; cron succeeds and scheduled runs are on time. Health checks remain unredirected. |

### F8 coverage

| Test ID | QA-CHECKLIST.md section |
|---|---|
| SYS-04, SYS-18 | Test preparation and automation (F8) |
| SYS-07, SYS-08, NEW-10, NEW-11, ONBN-03, ONBR-02 | Fixed-profile onboarding (F8) |
| ONBR-01 | Quick login and synthetic QA accounts (F8) |
| ADM-20, ADM-21 | Staff roster and CSV exports (F8) |
| ADM-22, ADM-23, ADM-24 | Volunteer detail and status workflow (F8) |
| NEW-14, ADM-40, PRD-15, PRD-16 | F8 — Oct 13 decisions / v1.2.0 |

**CHANGED — superseded historical notes:** The Oct 12 disagreement table above is retained as history only. Its SYS-08 C8 roster limitation, manual-approval copy, and no-age-cutoff references are superseded by F8. Current workflows above and the Oct 13 v8 master govern acceptance.

## F9 — Oct 14 phone menu, home-screen icon and sign-out / v1.2.1

Development automation: `pnpm --filter @workspace/scripts exec tsx src/phone-menu-check.ts`.

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-41 | NEW CHANGED | Phone admin navigation (F9, F11) | At 320×568, 375×667, 390×844 and 768×1024, sign in as test Admin, open ☰, scroll the nav and tap Resources. Reopen, traverse the links with Tab, close with Escape or the close button. | Header stays fixed; nav scrolls within the visible screen. All 11 links, including Reports after Volunteers and My Profile, are reachable with 44px tap targets and bottom safe-area padding. Resources opens; the page behind does not scroll; focus returns to the menu trigger when closed. |
| ACT-16 | NEW | Official sign-out | In a private window on the official address, quick-login as Volunteer · Active, open the round user menu and Sign out. Press Back, then open /dashboard. Repeat as Admin and using the test-account banner. In development simulate a failed sign-out request. | User menu closes. Whole React Query cache clears and replace navigation lands on the official /signin, including on network/403 failure. After successful sign-out, Back and /dashboard return to /signin without cached signed-in content. A failed request does not claim the server session ended. |

### F9 coverage

| Test IDs | Checklist section |
|---|---|
| VIS-04 | CCT brand and program identity (F9) |
| ADM-01 | Quick login and synthetic QA accounts (F9) |
| ACT-16, ADM-41 | F9 — phone menu, home-screen icon and sign-out |

Fix 10 / Fix 11 tests in the v9 master are deliberately not added yet; no full test-ID diff is run for this release.

## Coverage table — test ID → QA-CHECKLIST.md section

| Test ID | Checklist section |
|---|---|
| SYS-01 | Test preparation and automation |
| SYS-02 | Test preparation and automation |
| SYS-03 | Test preparation and automation |
| SYS-04 | Test preparation and automation |
| SYS-05 | Test preparation and automation |
| SYS-06 | Production readiness and operation |
| SYS-07 | Fixed-profile onboarding |
| SYS-08 | Fixed-profile onboarding |
| SYS-09 | Email identity and notification monitoring |
| SYS-10 | Email identity and notification monitoring |
| SYS-11 | Quick login and synthetic QA accounts |
| SYS-12 | Reminders and coverage alerts |
| SYS-13 | Production readiness and operation |
| SYS-14 | Production readiness and operation |
| SYS-15 | Test preparation and automation |
| SYS-16 | Test preparation and automation |
| SYS-17 | CCT brand and program identity |
| SYS-18 | Test preparation and automation |
| VIS-01 | CCT brand and program identity |
| VIS-02 | CCT brand and program identity |
| VIS-03 | Quick login and synthetic QA accounts |
| VIS-04 | CCT brand and program identity |
| VIS-05 | Public access and authentication |
| VIS-06 | Public access and authentication |
| VIS-07 | Public access and authentication |
| VIS-08 | Fix 3 — UI and copy polish |
| NEW-01 | Public access and authentication |
| NEW-02 | Public access and authentication |
| NEW-03 | Public access and authentication |
| NEW-04 | Public access and authentication |
| NEW-05 | Public access and authentication |
| NEW-06 | Fixed-profile onboarding |
| NEW-07 | Fixed-profile onboarding |
| NEW-08 | Fixed-profile onboarding |
| NEW-09 | Fixed-profile onboarding |
| NEW-10 | Fixed-profile onboarding |
| NEW-11 | Fixed-profile onboarding |
| NEW-12 | Public access and authentication |
| NEW-13 | Public access and authentication |
| NEW-14 | F8 — Oct 13 decisions / v1.2.0 |
| ONBN-01 | Quick login and synthetic QA accounts |
| ONBN-02 | Fixed-profile onboarding |
| ONBN-03 | Fixed-profile onboarding |
| ONBN-04 | Quick login and synthetic QA accounts |
| ONBR-01 | Quick login and synthetic QA accounts |
| ONBR-02 | Fixed-profile onboarding |
| ONBR-03 | Fixed-profile onboarding |
| ONBR-04 | Volunteer detail and status workflow |
| ANS-01 | Volunteer dashboard and profile |
| ANS-02 | Volunteer standing shifts |
| ANS-03 | Volunteer standing shifts |
| ANS-04 | Volunteer standing shifts |
| ANS-05 | Volunteer standing shifts |
| ANS-06 | Volunteer standing shifts |
| ANS-07 | Volunteer standing shifts |
| ANS-08 | Volunteer dashboard and profile |
| ACT-01 | Quick login and synthetic QA accounts |
| ACT-02 | Volunteer dashboard and profile |
| ACT-03 | Volunteer standing shifts |
| ACT-04 | Volunteer standing shifts |
| ACT-05 | Volunteer standing shifts |
| ACT-06 | CCT grid, blocked dates and one-time shifts |
| ACT-07 | Messaging |
| ACT-08 | Resource hub |
| ACT-09 | Resource hub |
| ACT-10 | Volunteer dashboard and profile |
| ACT-11 | Security, privacy and mobile accessibility |
| ACT-12 | Security, privacy and mobile accessibility |
| ACT-13 | Reminders and coverage alerts |
| ACT-14 | Security, privacy and mobile accessibility |
| ACT-15 | Fix 2 — production regression workflows |
| ACT-16 | F9 — phone menu, home-screen icon and sign-out |
| ADM-01 | Quick login and synthetic QA accounts |
| ADM-02 | Coordinator dispatch and master schedule |
| ADM-03 | CCT grid, blocked dates and one-time shifts |
| ADM-04 | CCT grid, blocked dates and one-time shifts |
| ADM-05 | CCT grid, blocked dates and one-time shifts |
| ADM-06 | CCT grid, blocked dates and one-time shifts |
| ADM-07 | Coordinator dispatch and master schedule |
| ADM-08 | CCT grid, blocked dates and one-time shifts |
| ADM-09 | CCT grid, blocked dates and one-time shifts |
| ADM-10 | CCT grid, blocked dates and one-time shifts |
| ADM-11 | CCT grid, blocked dates and one-time shifts |
| ADM-12 | CCT grid, blocked dates and one-time shifts |
| ADM-13 | Reminders and coverage alerts |
| ADM-14 | Reminders and coverage alerts |
| ADM-15 | Reminders and coverage alerts |
| ADM-16 | Messaging |
| ADM-17 | Messaging |
| ADM-18 | Staff roster and CSV exports |
| ADM-19 | Staff roster and CSV exports |
| ADM-20 | Staff roster and CSV exports |
| ADM-21 | Staff roster and CSV exports |
| ADM-22 | Volunteer detail and status workflow |
| ADM-23 | Volunteer detail and status workflow |
| ADM-24 | Volunteer detail and status workflow |
| ADM-25 | Volunteer detail and status workflow |
| ADM-26 | Roles and staff administration |
| ADM-27 | Roles and staff administration |
| ADM-28 | Email identity and notification monitoring |
| ADM-29 | Email identity and notification monitoring |
| ADM-30 | Resource hub |
| ADM-31 | Resource hub |
| ADM-32 | Quick login and synthetic QA accounts |
| ADM-33 | Quick login and synthetic QA accounts |
| ADM-34 | Security, privacy and mobile accessibility |
| ADM-35 | Fix 2 — production regression workflows |
| ADM-36 | Fix 2 — production regression workflows |
| ADM-37 | Fix 3 — UI and copy polish |
| ADM-38 | Coordinator dispatch and master schedule |
| ADM-39 | Reminder jobs clarity — v1.1.5 |
| ADM-40 | F8 — Oct 13 decisions / v1.2.0 |
| ADM-41 | F9 — phone menu, home-screen icon and sign-out |
| MIL-01 | Milestones — Optional: only if Prompt 27 / 28 is built |
| MIL-02 | Milestones — Optional: only if Prompt 27 / 28 is built |
| MIL-03 | Milestones — Optional: only if Prompt 27 / 28 is built |
| MIL-04 | Milestones — Optional: only if Prompt 27 / 28 is built |
| MIL-05 | Milestones — Optional: only if Prompt 27 / 28 is built |
| NTF-01 | Notification preferences — Optional: only if Prompt 27 / 28 is built |
| NTF-02 | Notification preferences — Optional: only if Prompt 27 / 28 is built |
| NTF-03 | Notification preferences — Optional: only if Prompt 27 / 28 is built |
| NTF-04 | Notification preferences — Optional: only if Prompt 27 / 28 is built |
| PRD-01 | Production readiness and operation |
| PRD-02 | Production readiness and operation |
| PRD-03 | Production readiness and operation |
| PRD-04 | Production readiness and operation |
| PRD-05 | Production readiness and operation |
| PRD-06 | Production readiness and operation |
| PRD-07 | Production readiness and operation |
| PRD-08 | Production readiness and operation |
| PRD-09 | Production readiness and operation |
| PRD-10 | Production readiness and operation |
| PRD-11 | Production readiness and operation |
| PRD-12 | Production readiness and operation |
| PRD-13 | Production readiness and operation |
| PRD-14 | Production readiness and operation |
| PRD-15 | F8 — Oct 13 decisions / v1.2.0 |
| PRD-16 | F8 — Oct 13 decisions / v1.2.0 |
| ACT-17 | F10 — Hour logging / v1.3.0 |
| ACT-18 | F10 — Hour logging / v1.3.0 |
| ADM-42 | F10 — Hour logging / v1.3.0 |

## F10 — Hour logging / v1.3.0

Development only for clock overrides and automated fixtures. Fix 11 Reports
workflows and the complete master test-ID comparison are covered below.

Focused development verification (isolated schema, synthetic personas, no real mail):
`NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts run smoke --hours-only`.
The default full smoke retains signup and the new confirm-hours → staff-review step;
focused mode does not replace or claim a passing signup test.

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-17 | NEW | Confirm served hours | After a QA reset, quick-login as Volunteer · Active. Note a standing shift's date on My Shifts. Open Home with development `?at=` five minutes after it ends. Tap Confirm 2 hours, then open My Shifts → Past shifts. Repeat for an ended one-time claim. | Before the shift ends there is no hours card. Afterward, Home shows the warm intro and at most 3 unlogged shifts, with Confirm / Different hours and a See all past shifts link. Confirmation briefly shows Logged: 2 hours ✓, then removes that row/card. Past shifts shows the same numeric entry and Edit; the monthly total updates. One-time shifts use their own duration/label. No emails. Onboarding sees no hours; Inactive can log shifts served before inactivation. |
| ACT-18 | NEW | Different hours, editing and limits | Edit the logged entry to 2.5 with a note. Try 0, 0.3 and 13. PUT hours for a future/not-ended shift, a slot not owned, a made-up slot and an occurrence 15 days old. On an unlogged row use Different hours to save 1.5, then 3. Test a 301-character note and a week-off/blocked/closed/cancelled occurrence. | Valid quarter-hours update the same row. Invalid amounts receive “Enter hours between 0.25 and 12, in quarter hours (for example 1.5).” Invalid shifts return 422 with the own-shifts/14-day contact message. Older shifts leave the window and cannot be edited by volunteers; the contact footer remains. No delete/Other-time action for volunteers. All data is own-only, with no staff names/adminNotes/other-volunteer counts. At 320px, inputs stay on screen and actions retain 44px targets. No email. |
| ADM-42 | CHANGED | Staff Hours card (F10, F12) | Open the volunteer's detail page as Admin. Inspect Hours between Shifts and Messages. Log an unlogged scheduled shift; add Other time for a past date, first with no note then with “Training” and 1 hour. Try a duplicate and future date; edit to 1.5, then Delete and confirm “Remove these hours?”. Without reloading, inspect Recent activity and totals. As a volunteer call all four admin hours methods. | Shows this/last Pacific month totals, 90-day history, Volunteer or staff name, notes, and amber Not logged rows. Other time requires “What was this time for?”. Duplicate is refused with the edit-existing message; future date is refused clearly. After Remove hours succeeds, the dialog closes only after the detail refetch; exactly one “Hours removed” activity entry and updated Hours totals appear without a reload. Overview/report totals refresh when viewed. The delete and its activity row commit together before the response; retrying DELETE creates no second activity. Audit details include date/source/hours/by and the admin actor. Volunteer receives 403 on every staff route. Staff can log older dates; volunteers can still edit staff-entered scheduled hours inside their window. |

ACT-18 note: the Fix 10 API/UI specification limits the list to loggable shifts within
the window. The master calls older entries “read-only”; they are absent from this
volunteer list rather than a separate older-history view. Staff retain their history.

### F10 coverage

| Test ID | QA-CHECKLIST.md section |
|---|---|
| SYS-04 | Test preparation and automation — updated isolated smoke, including confirm → staff review |
| SYS-06 | Production readiness and operation — exactly one additive table, Publish-managed |
| ADM-32 | Admin entry and team — transactional QA hours reset, non-test rows unchanged |
| ACT-17 | F10 — Confirm served hours |
| ACT-18 | F10 — Different hours, editing and limits |
| ADM-42 | F10 — Staff Hours card |

## F11 — Reports / v1.4.0

Read-only reports; no schema changes or new emails. Use isolated fixtures in
development. Production checks below are manual release checks, not permission
for the development test runner to access production.

| Test ID | Change | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-43 | NEW | Monthly hours by Resource Coordinator | After ACT-17, open Admin → Reports. Turn Show test accounts on, then off. Use Previous / Next. In development, open Reports with `?at=` a week after the logged shift so another assigned shift has ended. Click Message volunteers with unlogged shifts (do not send). Return and click a name. | Header says Volunteer hours, current Pacific month selected, Next disabled on current month. Test toggle includes/excludes QA users consistently in all totals, rows, trend and exports; included QA names have TEST badges. Team hours 2 (or actual total), one coordinator, one logged shift and a matching totals row. Unlogged ended shifts are amber; message composer contains exactly those volunteers, without prefilled text. Name opens their detail page. Twelve months and proportional blue-on-gray bars appear. Empty month says “No hours have been logged for {Month YYYY} yet.” Every column sorts, default name ascending. Inactive volunteers and staff Other time count. Fractions show up to two decimals without trailing zeros. Volunteers receive 403; signed-out requests receive 401 on all three reports endpoints. |
| ADM-44 | NEW | Reports CSV exports | On Reports, turn test accounts on; download hours by volunteer and all hour entries, and open in Google Sheets. Repeat with tests off and another month. Include fixture names/notes beginning with `=`, `+`, `-`, `@` and embedded quotes/newlines. | Dated filenames alliance-hours-by-volunteer-YYYY-MM.csv and alliance-hour-entries-YYYY-MM.csv. By volunteer columns: Volunteer, Email, Status, Hours logged, Shifts logged, Other time entries, Shifts not logged, Last logged; final Team total agrees with the page. Entry columns: Date, Volunteer, Shift, Hours, Entered by, Note, Last changed; date then name order. Standing time, one-time label or Other time; Volunteer or staff name; Pacific change time. UTF-8 BOM and safe formula/quote escaping. No test entries when toggle is off. |
| ADM-34 | CHANGED | Reports responsive layout and navigation | Open Reports at 375 and 768 px. Inspect admin desktop navigation at 1280, 1440 and 1920 px; open the phone sheet and user menu. | No horizontal page scrolling. Tiles stack; volunteer table becomes cards on phones. Reports appears immediately after Volunteers. All 11 phone items remain reachable, including My Profile. Desktop fits one line and omits duplicate My Profile, still available in the round user menu. |
| SYS-04 | CHANGED | Smoke: confirmed hours → Reports | Run the isolated Playwright smoke. After 2 hours are logged, open Reports as admin for that shift month, enabling tests if the volunteer is a QA user. | Team hours is 2, the volunteer row shows 2 hours and one shift, and both CSVs agree. |

### F9 production phone check

| Test ID | Change | Workflow | Steps | Expected result |
|---|---|---|---|---|
| PRD-17 | NEW | v1.2.1 on a real phone (F9) | After publishing, open https://cct.defendingthecause.org on a phone; quick-login as Admin, open the menu and tap its last item. Remove any earlier home-screen icon and add it again. Sign out from the user menu. | Every admin menu item is reachable (including the 11-item Reports navigation). Home-screen icon is the CCT stacked logo. Sign-out lands on /signin. |

### F10 and F11 production release check

| Test ID | Change | Workflow | Steps | Expected result |
|---|---|---|---|---|
| PRD-18 | NEW | Hour logging and Reports in production (F10, F11) | Review Publish's schema changes. For a first Fix 10 deployment, inspect volunteer_hours count and constraint names with separate read-only SQL statements as described in the master plan. As Admin, add Other time for Volunteer · Active on the last weekday: 2 hours, note “Production check”; edit to 1.5. Open Reports with test accounts on/off and download both CSVs. Reset QA test accounts. | Fix 10 introduces only volunteer_hours; Fix 11 introduces no database changes. A newly created table starts empty and has PK, FKs and the source, amount and source/shift-pairing CHECKs. On an already-used deployment, existing legitimate rows remain untouched; do not expect a zero count. QA entry saves and edits. Reports/CSVs show 1.5 with tests on and exclude it with tests off (other real hours still count). Reset removes QA hours, never real data. Check ACT-17 after the first real pilot shift ends. |

### F11 coverage

| Test ID | QA-CHECKLIST.md section |
|---|---|
| SYS-04 | F11 — Smoke: confirmed hours → Reports |
| ADM-01 | Admin entry and team — 11-item phone navigation |
| ADM-34 | F11 — Reports responsive layout and navigation |
| ADM-41 | F9 — Scrollable phone menu, now including Reports |
| ADM-43 | F11 — Monthly hours by Resource Coordinator |
| ADM-44 | F11 — Reports CSV exports |
| PRD-17 | F9 production phone check |
| PRD-18 | F10 and F11 production release check |

## F12 — Claim buttons and Recent activity / v1.4.1

The CHANGED ONBR-02 workflow above covers the onboarding-ready and Active personas at 375 px and desktop, including visible one-time cards, the account-active explanation, absent disabled Claim buttons, API refusal, and successful Active claims. Existing claimed shifts keep their signed-up and cancellation/contact states.

The CHANGED ADM-42 workflow above covers adding, editing and removing Other time, then seeing “Hours removed” and updated totals without reloading. Run `npm test` for the immediate committed activity/exactly-once route assertion; run the isolated Playwright `--hours-only` smoke for both F12 workflows.

### F12 coverage

| Test ID | QA-CHECKLIST.md section |
|---|---|
| ONBR-02 | F12 — Claim buttons; Onboarding-ready persona workflow |
| ADM-42 | F12 — Immediate Recent activity after removing hours; Staff Hours card workflow |
