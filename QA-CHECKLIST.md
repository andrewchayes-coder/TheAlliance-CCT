# Community Care Team — QA checklist

Workflow steps for the Google Sheet UAT tracker. Master: [Alliance Persona Test Run](docs/Alliance%20Persona%20Test%20Run.md), preserved unchanged. All **124** master IDs have a primary test row and a coverage-table entry. Coverage is a mapping, not a claim that manual UAT or optional features have passed.

## v1.1.0 workflow tags

- **NEW**: a master check missing as an explicit workflow in the earlier checklist.
- **CHANGED**: rewritten for current CCT branding, fixed-profile/status model, privacy, email identity or switch-only quick login; matching IDs added. Combined tags mean both.
- Every primary row puts its master ID beside its steps. Retained extra checks below have no exact matching master ID and are disclosed separately.
- Record tester, environment, date, Pass/Fail/Blocked and evidence beside each row when pasting into the tracker. A known master/app gap should be Blocked/Fail, not silently passed.

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
| SYS-01 | NEW; CHANGED | Seed | Run the guarded development seed twice, then verify-seed (commands below). Never seed production. | One ordinary dummy admin, 18 ordinary dummy volunteers with canonical statuses/complete fake fields, and 40 Mon–Fri overlapping slots, 09–11 through 16–18, capacity 2; no duplicates. Count five QA users separately. |
| SYS-02 | CHANGED | Automated tests | Run `npm test`. | All pass, including scheduleService (DST weeks, full overlapping grid, two live overlapping shifts, skip date, closed date, blocked occurrence, custom shift in now/next and coverage, custom-shift reminder de-dupe, DST-week custom shift), the route-guard test, privacy tests (incl. DOB/address/emergency contact), the quick-login on/off tests (production is off unless `QUICK_LOGIN_ENABLED` is "true" in any case; no key or cookie tests remain; a persona mapped to a non-test user is refused), and ensureTestAccounts idempotency (5 test users after two runs). |
| SYS-03 | CHANGED | Route-guard test | Inspect the registered-route guard test and quick-login endpoints. | Quick-login routes tagged public:quick-login, not exempted via a blanket allowlist. Retired testing entry-point routes no longer registered; normal session/CSRF tests remain. |
| SYS-04 | CHANGED | Playwright smoke test | Run the Playwright smoke test. | Passes end to end: sign-up → verify → complete profile → admin activates (no certification/background) → volunteer picks Tue 10–12 → admin blocks next Tue 10–12 (volunteer emailed, no reminder) → admin creates an open one-time shift → volunteer claims it → reminder logs → admin sends a message → volunteer reads it. |
| SYS-05 | CHANGED | Leftover search | Search portal/API/shared/database source for obsolete brand/status flows; exclude dependencies, generated outputs, reference migrations, the unchanged master and independent Canvas scaffold. Review compatibility hits. | Current CCT brand and three statuses in product flows. Historical enum values/read mapping and legacy email aliases may remain; whole-workspace zero-hit expectations and the master’s paths are outdated. |
| SYS-15 | CHANGED | Lighthouse | Run Lighthouse (mobile) accessibility on the volunteer dashboard, /onboarding, and admin home. | Each scores 95 or higher. |
| SYS-16 | NEW; CHANGED | Docs | Review DEPLOY.md, this checklist, CHANGELOG.md and QA-TEST-ACCOUNTS.md; run the QL-5 retired-access audit, excluding the unchanged master under docs. | Current grid/blocks/custom shifts, Postmark DNS and configured identity documented; true/false quick-login switch, republish, reset and turn-off-before-invites guidance. v1.1.0 recorded; no retired-access identifiers in active files. |
| SYS-18 | NEW; CHANGED | QA-CHECKLIST.md in sync (Prompt 26b) | Compare every master ID against primary rows and the coverage table; review NEW/CHANGED tags and unmatched retained checks. | All 124 IDs mapped once as primary rows. Optional IDs conditional. Master unchanged; discrepancies and unmatched checks disclosed. |

## CCT brand and program identity

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-17 | CHANGED | Static brand files | List artifacts/alliance-volunteer-portal/public/brand/ and inspect /brand/logo-horizontal.png response headers. | Approved horizontal/stacked/mark/favicon/touch/192/512 assets present, static long Cache-Control, no runtime storage dependency. |
| VIS-01 | NEW | Style guide | Open /style-guide in dev. | Shows navy / Alliance Blue / gray / white only, Open Sans in sentence case (no forced uppercase), buttons, inputs, badges ("good" = blue), both logos, and an email preview. No blue text on gray. Works at 375 px. |
| VIS-02 | CHANGED | Sign-in page brand | Open /signin at 375 px and on desktop. | No navy band. Stacked logo centered (max 240 px) above the card. Mission line in 15 px navy under the card. Gray inputs with a blue focus ring. Primary button blue, hover navy. |
| VIS-04 | CHANGED | Favicon & manifest | Check the browser tab, the web manifest, and Add to Home Screen on a phone. | Favicon is the circle mark. Manifest name "Community Care Team Volunteer Portal", short_name "CCT Portal", theme #06365D, background #FFFFFF, 192/512 icons. Home-screen icon uses apple-touch-icon. |

## Public access and authentication

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| VIS-05 | CHANGED | Signed-out redirects | Visit /dashboard, /shifts and /admin. Call GET /api/me and GET /api/admin/volunteers. | Pages redirect to /signin. The APIs return 401. |
| VIS-06 | CHANGED | Forgot password is non-revealing | Submit /forgot-password once with an unknown email and once with a real one. | Both show the same confirmation message. |
| VIS-07 | CHANGED | Sign-in errors & rate limit | Sign in with a wrong password repeatedly. | Generic error (doesn't say which field is wrong), then a friendly rate-limit message. |
| NEW-01 | CHANGED | Sign-up | Open /signup; try a 7-character password, mismatched confirmation and invalid phone, then valid names, US phone and matching password of at least 8 characters. | Friendly intro and validation; volunteer/onboarding profile created; /verify-email shows address. Stored phone ten digits. A 9-character password is not intrinsically too short. |
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
| SYS-08 | NEW; CHANGED | Flags are reversible | Developer-only compatibility check in isolated dev: enable the retained background-tracking flag, compare detail/CSV/roster, then restore false. | KNOWN GAP: detail/CSV handling can return but the v2 roster has no tracking badge/filter controls. Do not mark the master’s full reversibility expectation passed. Normal v2 hides disabled tracking. |
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
| ACT-10 | CHANGED | Profile edits | On /profile, edit phone, address and emergency contact. | Changes save. Email, DOB, status and start date are read-only (start date filled in). |

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
| ADM-03 | CHANGED | Load standard grid | Load standard grid twice on the seeded grid; also load twice in an empty isolated dev schema. Do not delete operational slots. | Seeded grid creates 0; empty grid creates 40 then 0. No slot-delete UI exists, so the master’s delete-two-slots instruction cannot be followed. |
| ADM-04 | CHANGED | Grid editor | Add a slot that overlaps another. Check the default end time. Try "Copy Monday to all weekdays" on a scratch setup. | Overlap shows an "overlaps with …" note, not an error. End time defaults to start + 2 hours. Copy fills the weekdays. |
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

## Staff roster and CSV exports

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ADM-18 | CHANGED | Roster defaults | Open /admin/volunteers. Toggle "Show test accounts". | Default contact/city/start/shifts/login columns; No shift amber. QA hidden by default; Show test accounts reveals four volunteer profiles (fifth persona is the admin on Team). Summary chips exclude QA either way. |
| ADM-19 | CHANGED | Columns, sort, layout | Use the Columns picker to show DOB, full address, ZIP, emergency contact, county. Reload. Sort by several columns. Check desktop and mobile. | Picker choice survives reload. Sorting works on every column. Sticky header and first column on desktop; stacked cards on mobile. |
| ADM-20 | CHANGED | Filters & chips | Combine filters (e.g. Active + No shift; city + profile incomplete). | Results are the correct intersection. Chips show Onboarding / Active / Inactive counts and "Needs attention" (active with 0 shifts, incomplete profile &gt; 7 days, onboarding &gt; 30 days). No certification or background columns or filters. |
| ADM-21 | CHANGED | CSV exports | Export the Roster CSV and Schedule CSV and open both in Google Sheets. | Dated filenames, open cleanly. Roster: status, start date, DOB, address, city, state, ZIP, emergency contact name/relationship/phone, county, shifts held ("Tue 10:00–12:00; …"); no certification, background, agreement or onboarding-answer columns. Schedule: one row per active assignment including one-time shifts, with upcoming skip dates. No test accounts in either. |

## Volunteer detail and status workflow

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| ONBR-04 | CHANGED | Activated by admin | Keep this signed in on device A. On device B, do ADM-22. Refresh device A. | Top card becomes "Choose your weekly shift", quick links appear, and the approval email ("You're approved! Choose your weekly shift") is logged as `suppressed`. |
| ADM-22 | CHANGED | Activate a volunteer | Open Volunteer · Onboarding, ready to activate (show test accounts on). Move to Active (confirm). (Do this from device B during ONBR-04.) | Verified, complete profile with recorded onboarding completion becomes Active without disabled compliance gates; Pacific start date supplied if absent. Central-service approval mail suppressed for TEST. |
| ADM-23 | CHANGED | Activation blocked when incomplete | Remove required profile fields, verification or onboardingCompletedAt on an isolated synthetic volunteer; try activation and inspect missing conditions. | Button/API block every missing condition, including full field values without recorded completion. No override bypass. |
| ADM-24 | CHANGED | Volunteer detail page | On any volunteer: edit start date inline, edit DOB and emergency contact in the Profile card, change county, type admin notes. | Profile card labeled "Visible to Alliance staff only" with tap-to-call emergency phone. County is admin-only (default Placer). Admin notes autosave. Activity log names the changed fields but never the values. No certification, background or agreement cards. |
| ADM-25 | CHANGED | Inactivate releases shifts | Move Volunteer · Active to Inactive. Then Reset test accounts. | Confirm dialog lists the shifts being released. Assignments end today. A coverage-gap alert goes to real admins. The persona's dashboard shows the gentle inactive note. Reset restores it. |

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
| SYS-12 | CHANGED | Job runner | In isolated dev enable RUN_JOBS, observe a 15-minute run, restore false. POST /api/jobs/run with missing/wrong/correct X-Jobs-Secret, then the alternate header named after the environment variable. | Only X-Jobs-Secret authenticates; alternate/query/cookie credentials refused. Valid call returns bounded results (approximately 20-second budget). Production runs no internal scheduler; dev requires RUN_JOBS=true. |
| ACT-13 | CHANGED | Reminder de-dupe for test account | After ADM-15, check this persona's reminder rows in the notification log. | One `suppressed` reminder row. Running the reminder check again adds no second row. (If it does, suppressed rows aren't counted by the de-dupe check: report it as a bug.) |
| ADM-13 | CHANGED | Coverage-gap alert | After ACT-05, filter the notification log by type admin_alert. | Exactly one alert per real admin (e.g. admin@example.org): "Coverage gap: {Tue Oct …}, 10:00–12:00 now has 1 of 2 volunteers (Test A. took the week off)." with a button to that week. No row for qa-admin@example.org. |
| ADM-14 | CHANGED | Daily digest | With the digest toggle on and a gap in the next 7 days, trigger the digest twice the same day (job endpoint or Run now). Then remove all gaps and trigger. Then turn the toggle off and trigger. | One digest per real admin for the day (relatedId = date); none to the test admin. Nothing sent when there are no gaps, or when the toggle is off. |
| ADM-15 | CHANGED | Reminders | In isolated dev create a custom shift due within the next 24 hours, assign ACT plus a non-test dummy, run reminders twice and 15 minutes late; test week-off/block/closure exclusions. Use an ordinary synthetic admin for logged test-to-me checks. | One delivery per eligible assignment/date; reruns skip confirmed rows. TEST mail suppressed, not delivered. Late unsent recipients catch up; uncertainty never resent; statistics update. More than 24 hours away is not yet due. |

## Email identity and notification monitoring

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-09 | CHANGED | Email template (log mode) | Use an isolated dev API with provider delivery disabled and a non-test synthetic recipient. Send a test email; do not use TEST mail to prove logged delivery. | Console includes full text/links and From/Reply-To; notification row logged. CCT logo/header/blue button/footer and plain text included. Sender is configured identity; footer is the team contact, not a personal mailbox. |
| SYS-10 | NEW; CHANGED | EMAIL_FROM / EMAIL_REPLY_TO | In isolated dev test malformed EMAIL_FROM, restore valid Display Name &lt;address&gt;, and set/unset EMAIL_REPLY_TO before logged sends. | Invalid identity fails loudly without exposing credentials. Explicit Reply-To wins; absent override falls back to configured sender address, not a hardcoded staff mailbox. |
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
| SYS-11 | CHANGED | Test accounts exist once | Restart isolated dev twice and run ensureTestAccounts twice; inspect flagged users/profiles and shared/testAccounts.ts definitions. | Exactly five flagged, active, verified users of expected roles; four volunteer profiles and one admin. Replaced personas reuse their identities/history; no orphaned aliases or duplicate users. |
| VIS-03 | CHANGED | Quick-login card (dev) | Look below the sign-in card in dev. | Amber dashed Quick login — testing card with the five current persona buttons, one column at 375px and at least 44px targets. Current onboarding labels only; CCT sentence-case styling. |
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
| ACT-14 | CHANGED | Phone & tablet walk | Walk every volunteer screen at 375 px and 768 px. | No horizontal scrolling. Tap targets at least 44 px. Dashboard usable one-handed. |
| ADM-34 | CHANGED | Phone & tablet walk | Walk every admin screen at 375 px and 768 px. | No horizontal scrolling. Tables become cards. On shift now is usable one-handed. |

## Production readiness and operation

| Test ID | Tag | Workflow | Steps | Expected result |
|---|---|---|---|---|
| SYS-06 | NEW; CHANGED | Schema is additive | Review existing schema/reference SQL under lib/db and the proposed Publish diff without applying it. | Only additive columns/default/status changes; no drop/rename/type conversion. Reference migrations never execute at boot. |
| SYS-13 | CHANGED | Production-mode lockdown | Use the isolated production-mode harness, with synthetic data and no live delivery, to check seed refusal, dev-route/time-override lockdown and production quick-login enable/disable. | Seed refuses production; development-only routes/overrides disabled. Quick login depends only on the production switch; normal protected-route guards remain. |
| SYS-14 | NEW | Health route | GET /api/health. | Returns database and email-config status with no secret values. |
| PRD-01 | NEW | Enum value before publish | Before publishing Prompt 22's schema, run `ALTER TYPE volunteer_status ADD VALUE IF NOT EXISTS 'onboarding';` in the production Database tool. | Runs without error. |
| PRD-02 | NEW | Publish change list | Publish and read the schema change list. | Only additive changes. If anything is dropped, renamed or converted, choose Cancel deployment. Never "Copy your development database schema & data to production". |
| PRD-03 | NEW; CHANGED | Status update | Inspect production statuses read-only. Only if separately approved, an authorized operator may run DEPLOY.md’s optional backfill after the enum commits. Do not execute it during checklist sync. | Read normalization works without backfill. Approved optional update touches only legacy statuses; no fabricated real profile values, active/inactive unchanged. |
| PRD-04 | NEW | Health & clean data | GET /api/health. Check users for admin@example.org or dummy volunteers. | Health OK. No seed data. The only @example.org users are the 5 qa-* test accounts. |
| PRD-05 | NEW; CHANGED | Grid in production | Click "Load Community Care Team standard grid" once, then once more. | Empty grid first creates 40 then 0; an existing grid creates 0 and is not overwritten. Closures/blocks/custom shifts use Pacific time. |
| PRD-06 | NEW; CHANGED | Live test email | Authorized operator with a normal verified admin sends a production test email via the documented production-check command; inspect identity/logo/domain verification. TEST admin cannot prove delivery. | Configured CCT sender and explicit Reply-To or sender-address fallback; logo renders, token configured, DKIM/Return-Path verified. No inferred personal mailbox. |
| PRD-07 | CHANGED | Quick login on, no unlock | With `QUICK_LOGIN_ENABLED=true` in Secrets (republished), open /signin in a fresh private window. | Testing card appears immediately with test-account and production pills and all five buttons; no device-specific access action. |
| PRD-08 | CHANGED | Old unlock routes gone | Visit retired testing entry points described in master PRD-08 without sharing credentials; return to /signin. | Normal not-found page, no session/device-unlock action. Enabled quick login is independent of those URLs. |
| PRD-09 | CHANGED | All 5 personas | Sign in as each persona. | Admin → /admin. Active → next-shift card (or choose-shift if it has none). Active, no shift → choose-shift card. Onboarding, ready → dashboard checklist. Onboarding, new → /onboarding. |
| PRD-10 | CHANGED | Reset after prod testing | If any persona took a shift, Team → Reset test accounts. Check the master schedule. | Prod Volunteer · Active starts with no shift after reset, and any capacity used in testing is freed. |
| PRD-11 | CHANGED | Turn quick login off | When prod testing is done (and before the first pilot invites): set `QUICK_LOGIN_ENABLED=false`, republish, open /signin in a fresh window, and call GET /api/auth/quick-login/status. | No quick-login card. The status call returns 404. Normal sign-in still works. |
| PRD-12 | CHANGED | External cron | Watch /admin/notifications/jobs for 30+ minutes. On a weekday after 7 AM, check the log for the digest. | cron-job.org POST every 15 minutes, X-Jobs-Secret header, JSON {}; production built-in scheduler disabled. Approximately 20-second budget, unsent catch-up, confirmed/suppressed dedupe and no uncertain resend. |
| PRD-13 | CHANGED | Production lockdown | Restart logs; open /style-guide; add ?at= to admin home. | Startup secrets check passes. /style-guide is 404. ?at= is ignored. |

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
| VIS-08 | CHANGED | Sign-in and install metadata | Sign in with googleEnabled false, then true when configured. Inspect /manifest.webmanifest response headers. | Disabled Google button and its “or” divider are hidden, without removing Google code. Enabled Google remains available. Manifest Content-Type is application/manifest+json. |
| VIS-08 | CHANGED | My Shifts dates and displayed phones | View a standing shift starting in the future, then a past start date. Inspect displayed mobile/emergency numbers, including On shift now and the schedule side panel. | Future dates say “Starts”; past dates say “Started”. Ten-digit US phones display as (XXX) XXX-XXXX; tap-to-call remains available. |
| ADM-37 | CHANGED | QA persona labels | Inspect both Active personas on the master schedule, its side panel, On shift now, Team → Test accounts and message recipient search. | Schedule surfaces distinguish “Test · Active” and “Test · Active, no shift”, keeping gray TEST badges. Team uses the same shared persona labels as sign-in. Test recipients have TEST badges. |
| ADM-37 | CHANGED | Weekend default week | On Saturday and Sunday (also DST weekends), open the master schedule with no week parameter and press Today after navigating away. Check admin-home This week stats. Select a previous week explicitly. | Default/Today and overview stats use the coming Monday–Friday week. Explicit previous-week selection still works; live On shift now logic is unchanged. |
| ADM-37 | CHANGED | Staff Profile and capacity guidance | Click each Profile-card label and inspect htmlFor/id associations. Edit a slot with N assignments. | Each label focuses its own control. The helper says “N volunteers are assigned, so capacity can't go below N.” Capacity enforcement is unchanged. |

## Master/app disagreements

The master has not been edited. Current workflow expectations above are adjusted only where the app/policy differ; gaps are called out explicitly.

| Master ID(s) | Difference |
|---|---|
| SYS-05, SYS-17 | Master assumes client/server/shared-schema locations and whole-workspace zero hits. Actual paths are artifacts/... and lib/db; historical migrations, the unchanged master, deliberate identity aliases and registered Canvas scaffolding require exclusions. |
| SYS-01, SYS-11 | Ordinary seed counts exclude the additional five QA identities. User rows and volunteer-profile rows are not interchangeable. |
| SYS-07, SYS-09, SYS-10, ANS-05, ACT-04, ACT-07, PRD-06 | Master expects personal Cindi contact/Reply-To/footer fields. Current app uses public Community Care Team contact; Reply-To uses explicit EMAIL_REPLY_TO or configured sender fallback. Dev rejects malformed identity at send; startup checks are production-only. |
| SYS-08 | Master promises flag restoration of roster badges/filters. The v2 roster has removed those controls; retained detail/CSV behavior is only partial compatibility. Known gap, not a passed master test. |
| SYS-12 | Master names an alternate machine header. Only X-Jobs-Secret is accepted. The environment variable is not an accepted header name. |
| VIS-03 | Master quotes uppercase card/pill text; current CCT brand uses sentence-case testing labels. |
| NEW-01 | Master treats a nine-character password as too short; actual minimum is eight. The negative test uses seven characters. |
| ADM-03 | Master asks to delete two slots in the editor; current editor offers deactivation, not deletion. Idempotence is checked with the seeded grid and an empty isolated grid. |
| ADM-15 | Master expects a future 24h–24h15m reminder and test-admin delivery. Current catch-up selects already-due reminders (within next 24h); TEST mail is suppressed. Use an ordinary synthetic admin in an isolated dev scope for logged delivery. |
| ADM-18 | Master expects five entries in the volunteer roster; four are volunteers and the fifth is the admin in Team. |
| PRD-03 | Master makes a production backfill unconditional. Current policy requires separate operator approval; read normalization works without it. No production update was performed. |
| PRD-05 | Loader creates 40 only on an empty grid, not a previously configured one. |
| MIL-*, NTF-* | Future feature checks remain conditional; checklist coverage does not claim those features exist. |

## Coverage table — test ID → QA-CHECKLIST.md section

| Test ID | Checklist section |
| VIS-08 | Fix 3 — UI and copy polish |
| ADM-37 | Fix 3 — UI and copy polish |
| ADM-35 | Fix 2 — production regression workflows |
| ACT-15 | Fix 2 — production regression workflows |
| ADM-36 | Fix 2 — production regression workflows |
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
