# Community Care Team — QA checklist

Workflow steps for the Google Sheet UAT tracker. Master: [Alliance Persona Test Run](docs/Alliance%20Persona%20Test%20Run.md), preserved unchanged during this sync. **CHANGED:** All **132** Oct 12 master IDs have a primary test row and a coverage-table entry. Coverage is a mapping, not a claim that manual UAT or optional features have passed.

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
| SYS-04 | CHANGED | Playwright smoke test | Run the Playwright smoke test. | Passes end to end: sign-up → verify → complete profile → admin activates (no certification/background) → volunteer picks Tue 10–12 → admin blocks next Tue 10–12 (volunteer emailed, no reminder) → admin creates an open one-time shift → volunteer claims it → reminder logs → admin sends a message → volunteer reads it. |
| SYS-05 | CHANGED | Leftover search | Search `artifacts/alliance-volunteer-portal`, `artifacts/api-server`, `shared` and `lib/db` for 02928F, 027A77, lulo, montserrat, Resource Coordination Program, applicant and in_training, using the master’s grep commands. Exclude dependencies, build output, migrations, `docs/` and the separate `artifacts/mockup-sandbox`. | No obsolete colors, fonts or program name in screens or emails. applicant / in_training remain only in the retained database enum and read-time mapping in `shared/legacy-compatibility.ts`. Review and explain other deliberate compatibility hits, such as email aliases, rather than automatically failing them. No obsolete values in `shared/testAccounts.ts`, UI copy or emails. |
| SYS-15 | CHANGED | Lighthouse | Run Lighthouse (mobile) accessibility on the volunteer dashboard, /onboarding, and admin home. | Each scores 95 or higher. |
| SYS-16 | NEW; CHANGED | Docs | Review DEPLOY.md, this checklist, CHANGELOG.md and QA-TEST-ACCOUNTS.md; run the QL-5 retired-access audit, excluding the unchanged master under docs. | Current grid/blocks/custom shifts, Postmark DNS and configured identity documented; true/false quick-login switch, republish, reset and turn-off-before-invites guidance. v1.1.0 recorded; no retired-access identifiers in active files. |
| SYS-18 | NEW; CHANGED | QA-CHECKLIST.md in sync (Prompt 26b) | After the Oct 12 master re-upload, run the master’s ID-diff command and read “Master/app disagreements (resolved Oct 12)”. Check primary rows and the coverage table. | No diff output: all 131 master IDs are present. No unresolved master/app disagreements; SYS-08 records its accepted limit, and MIL/NTF remain optional and not built. No obsolete applicant / in_training or certification, background-check or agreement-gating workflows remain in normal v2 tests. Explicit legacy-schema and flag checks remain documented. |

## CCT brand and program identity

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-17 | CHANGED | Static brand files | List `artifacts/alliance-volunteer-portal/public/brand/` and inspect the response headers on `/brand/logo-horizontal.png`. | `logo-horizontal.png`, `logo-stacked.png`, `logo-mark.png`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` are present and served as static files with long Cache-Control headers, not from Object Storage. |
| VIS-01 | NEW | Style guide | Open /style-guide in dev. | Shows navy / Alliance Blue / gray / white only, Open Sans in sentence case (no forced uppercase), buttons, inputs, badges ("good" = blue), both logos, and an email preview. No blue text on gray. Works at 375 px. |
| VIS-02 | CHANGED | Sign-in page brand | Open /signin at 375 px and on desktop. | No navy band. Stacked logo centered (max 240 px) above the card. Mission line in 15 px navy under the card. Gray inputs with a blue focus ring. Primary button blue, hover navy. |
| VIS-04 | CHANGED | Favicon & manifest | Check the browser tab, the web manifest, and Add to Home Screen on a phone. | Favicon is the circle mark. Manifest name "Community Care Team Volunteer Portal", short_name "CCT Portal", theme #06365D, background #FFFFFF, 192/512 icons. Home-screen icon uses apple-touch-icon. |

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
| SYS-07 | NEW; CHANGED | Config flags | Inspect shared/appConfig.ts and shared/onboardingQuestions.ts. | Three tracking flags false; minimumAge null; question array empty; CCT identity, mission and Resource Coordinator role match v2. Public contact is the Community Care Team mailbox, not a personal staff contact. |
| SYS-08 | NEW; CHANGED | Flags are reversible | In development only, set `trackBackgroundCheckInApp` to true, restart, inspect the roster and volunteer detail, and check the CSV column. Restore false and restart before continuing. | With true, the detail background-check card and CSV column return; the roster badge and filter do not. This is the accepted C8 limit while tracking stays off; restoring roster controls if tracking is enabled would be a change order. With false, all background-check display/CSV tracking is hidden again. |
| NEW-06 | CHANGED | Onboarding screen | Look over /onboarding. | One screen. Intro: "Welcome to the Community Care Team. A few details help us support you and reach someone if we ever need to." Email read-only; name and phone prefilled and editable. DOB, address, city, state (default CA), ZIP, emergency contact name / relationship (with suggestions) / phone. "Only Alliance staff can see this." under DOB and emergency contact. No questionnaire, no agreement checkbox, no county. |
| NEW-07 | CHANGED | Onboarding validation | Blur-save empty/null draft fields; then try a future DOB, invalid calendar date, 4-digit ZIP, short/nonnumeric phone, and overlong fields in the form and PATCH /api/onboarding. Repeat invalid nonempty values on volunteer Profile and the admin Profile card. Finish onboarding with required fields blank. | Empty/null drafts are allowed, but completion requires all fields. Invalid nonempty saves return 400 with fieldErrors and do not save the bad values. ZIP+4 is accepted; formatted US phones are stored as 10 digits. |
| NEW-08 | CHANGED | Save on blur | Fill about half the fields, then refresh. | Everything you entered is still there. |
| NEW-09 | CHANGED | Profile required before dashboard | Before finishing, go to /dashboard. | Redirected back to /onboarding. |
| NEW-10 | CHANGED | Finish onboarding | Complete every field and submit. | Lands on /dashboard. Welcome email logged with "Here's what happens next: our team will reach out about training and the required paperwork. Once you're approved, you'll choose your weekly shift." Status is onboarding. Phones stored as digits only. |
| NEW-11 | CHANGED | Onboarding dashboard card | Look at the dashboard top card. | Checklist: Account created ✓ · Profile complete ✓ · Training & paperwork (with Alliance staff) · Approval, with "We'll email you when you're ready to choose a shift." No quick-links row. No certification, background, or agreement text. |
| ONBN-02 | CHANGED | Locked until profile done | With required fields empty, visit /dashboard, /shifts, /my-shifts, /messages, /resources, and /profile. Then use a completed onboarding persona to visit /shifts. | Incomplete volunteers redirect to /onboarding; only onboarding and the agreement page permit incomplete profiles. Complete, not-active volunteers see why they cannot book yet. |
| ONBN-03 | CHANGED | Complete profile | Complete the profile. | Lands on /dashboard with the onboarding checklist. The welcome email shows in Admin → Notifications as `suppressed` (and prints in the dev console). |
| ONBR-02 | CHANGED | Can't sign up yet | Open /shifts. Then POST to the shift sign-up API from devtools. | /shifts explains why sign-up isn't open yet, with no sign-up buttons. No quick-links row on the dashboard. The API returns 403. |
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
| ADM-20 | CHANGED | Filters & chips | Use each Needs attention reason: Awaiting review, No shift, Profile incomplete for more than 7 days, Onboarding for more than 30 days. Combine Active + No shift and city + Awaiting review; export both CSVs with a reason selected. | Results are the correct intersection. Chips show Onboarding / Active / Inactive and Needs attention counts. Every onboarding volunteer immediately has Awaiting review alongside any other applicable reasons. Both CSVs use the same reason filter. No certification or background columns, filters or reasons. |
| ADM-21 | CHANGED | CSV exports | Export the Roster CSV and Schedule CSV and open both in Google Sheets. | Dated filenames, open cleanly. Roster: status, start date, DOB, address, city, state, ZIP, emergency contact name/relationship/phone, county, shifts held ("Tue 10:00–12:00; …"); no certification, background, agreement or onboarding-answer columns. Schedule: one row per active assignment including one-time shifts, with upcoming skip dates. No test accounts in either. |

## Volunteer detail and status workflow

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ONBR-04 | CHANGED | Activated by admin | Keep this signed in on device A. On device B, do ADM-22. Refresh device A. | Top card becomes "Choose your weekly shift", quick links appear, and the approval email ("You're approved! Choose your weekly shift") is logged as `suppressed`. |
| ADM-22 | CHANGED | Activate a volunteer | Open Volunteer · Onboarding, ready to activate with test accounts shown. Read Volunteer review and approval; click Approve as Active → Confirm approval as Active. Use device B during ONBR-04. | Checklist says Ready for staff approval, every requirement Complete, and Pending: Staff approval as Active. Dialog says Approve as Active? and explains approval email is attempted after saving. No certification/background gates; absent start date defaults to today Pacific. Result explains TEST approval email wasn't sent and logs suppressed. Roster, overview and Needs attention refresh without reload; activity records approval. |
| ADM-23 | CHANGED | Activation blocked when incomplete | Open Volunteer · Onboarding, new after resetting, before ONBN-03. Inspect the checklist and attempt approval through the API. | Waiting on volunteer requirements lists Onboarding completed and each empty profile field, who completes it, links to the right section, and Message volunteer about missing steps. Approve as Active isn't offered. API returns 422 with missing items listed; no override bypass. |
| ADM-24 | CHANGED | Volunteer detail page | On any volunteer: change only start date inline and inspect Activity. Then save start date together with another profile field. Edit DOB, emergency contact, county and notes. | A start-date-only edit creates one "Start date changed" entry and no "Profile updated (start date)" duplicate. A mixed edit logs start date separately; Profile updated names only the other fields, never values. Profile card remains staff-only, county admin-only (default Placer), and notes autosave. No certification, background or agreement cards. |
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
| ONBR-01 | CHANGED | Quick login | Click "Volunteer · Onboarding, ready to activate". | Lands on /dashboard (not /onboarding). Checklist shows Profile complete ✓ and waits on Training & paperwork and Approval. |
| ACT-01 | CHANGED | Quick login & banner | After Reset test accounts, click "Volunteer · Active". Use Switch account in the banner, then Sign out. | Dashboard shows "Your next shift" for its one seeded shift. Switch account lists the other 4 personas and one click switches. Sign out returns to /signin. |
| ADM-01 | CHANGED | Quick login | Click "Admin". | Lands on /admin with the TEST banner. Mobile nav uses a hamburger sheet. |
| ADM-32 | CHANGED | Reset test accounts | Team → Test accounts card → Reset test accounts (confirm). | Card lists 5 personas with last login. After reset: Volunteer · Active has one seeded shift (dev), others are back to defaults, their message rows are cleared, their one-time claims are cancelled (cancelledAt set). The reset is in the activity log. |
| ADM-33 | CHANGED | TEST badges on one-time claims | After ACT-06, look at the one-time shift on the master schedule, its side panel, and the roster. | The test persona has the gray TEST badge in all three places. |

## Security, privacy and mobile accessibility

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ACT-11 | CHANGED | Admin APIs blocked | From devtools, call several /api/admin/* routes. Visit /admin. | Every API returns 403. /admin redirects to /dashboard. |
| ACT-12 | CHANGED | Privacy in responses | Inspect network responses on /dashboard, /shifts, /messages and /resources. | No other volunteer's name, email or phone. No adminNotes. No DOB, address or emergency contact for anyone except yourself. |
| ACT-14 | CHANGED | Phone & tablet walk | Walk every volunteer screen at 375 px and 768 px. | No horizontal scrolling. Tap targets at least 44 px. Dashboard usable one-handed. Every page uses the same page header (title, subtitle, actions); long titles and actions wrap cleanly at 375 px. |
| ADM-34 | CHANGED | Phone & tablet walk | Walk every admin screen at 375 px and 768 px. | No horizontal scrolling. Tables become cards. On shift now is usable one-handed. Every admin page uses the same page header; actions wrap under the title on narrow screens. |

## Production readiness and operation

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-06 | NEW; CHANGED | Schema is additive | Review existing schema/reference SQL under lib/db and the proposed Publish diff without applying it. | Only additive columns/default/status changes; no drop/rename/type conversion. Reference migrations never execute at boot. |
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
