# Alliance Volunteer App — Persona Test Run (Prompts 1–28)

Hayes Strategy Group · Oct 10, 2026 · Built from every **Check** line in Build Prompts v1 (1–20), the Quick Login addendum (QL-1 to QL-5) and Build Prompts v2 (21–28). Same rows are in `Alliance Persona Test Run.xlsx` for the UAT Google Sheet.

**What this tests:** the finished app after Prompt 26 (plus 27–28 if built). Where a later prompt changed an earlier Check, the test is written for the final behavior. The changed checks are listed under *Superseded v1 checks* at the end.

**How this relates to QA-CHECKLIST.md:** that file lives in Replit. Prompt 19 created it and only Prompt 26 updates it; Prompts 27–28 don't touch it. Use this doc as the master list. After Prompt 26, compare it with QA-CHECKLIST.md for gaps.

## Before you start

1. Run in **dev** unless the section says Production. `?at=` (dev only) fakes the current time for schedule checks.
2. Admin → Team → **Reset test accounts** so every persona starts clean (in dev, Volunteer · Active gets one standing shift).
3. Have two browsers (or one normal + one private window) for the cross-persona checks: ONBR-04 / ADM-22 and the race in ANS-07.
4. Test personas never receive email: their emails show as `suppressed` in Admin → Notifications (and print in the dev console). Use the NEW account or the seeded admin@example.org for anything that needs a real send.
5. Run order: SYS → VIS → NEW → ONBN → ONBR → ANS → ACT → ADM → MIL/NTF (optional) → PRD. Cross-references (e.g. "after ADM-11") note where one persona's step depends on another's.

## Personas

| Code | Persona | Setup | Env | Tests |
|---|---|---|---|---|
| SYS | Developer / system | Replit shell + dev URL. No sign-in. Tests, seed, grep, config, jobs, Lighthouse, docs. | Dev | 18 |
| VIS | Signed-out visitor | Private/incognito window, not signed in. | Dev | 7 |
| NEW | New sign-up (real account) | A fresh account you create in dev with an email you control (plus-addressing works). Not a test account, because test accounts never receive email. With no Postmark token in dev, emails and links print to the console. Keep this account; ADM-27 deactivates it. | Dev | 13 |
| ONBN | Volunteer · Onboarding, new | Quick-login persona. Verified, profile fields empty. | Dev | 4 |
| ONBR | Volunteer · Onboarding, ready to activate | Quick-login persona. Profile complete, waiting for staff approval. | Dev | 4 |
| ANS | Volunteer · Active, no shift | Quick-login persona. Approved, holds no standing shift. | Dev | 8 |
| ACT | Volunteer · Active | Quick-login persona. In dev, starts with one standing shift after Reset test accounts. | Dev | 14 |
| ADM | Admin | Quick-login Test Admin. Alerts and digests are never sent to the test admin, so those checks read the notification log for the seeded dev admin (admin@example.org). | Dev | 34 |
| MIL | Admin · Prompt 27 (optional) | Only if Prompt 27 (milestones) is approved and built. | Dev | 5 |
| NTF | Admin · Prompt 28 (optional) | Only if Prompt 28 (admin shift-activity notifications) is approved and built. | Dev | 4 |
| PRD | Production | After the Prompt 26 publish. Quick login is on when `QUICK_LOGIN_ENABLED=true` (no unlock link since QL-5). | Prod | 13 |

## SYS — Developer / system

_Replit shell + dev URL. No sign-in. Tests, seed, grep, config, jobs, Lighthouse, docs._

- [ ] **SYS-01 · Seed** (P2, P22, P24)  
  **Do:** Run `npm run seed` twice.  
  **Expect:** Both runs finish with no errors and no duplicates. DB has 1 admin, 18 dummy volunteers with status onboarding / active / inactive only (none applicant or in_training), and 40 shift slots (Mon–Fri × 9–11, 10–12, 11–1, 12–2, 1–3, 2–4, 3–5, 4–6, capacity 2).

- [ ] **SYS-02 · Automated tests** (P10, P19, P24, P26, QL-1, QL-2, QL-5)  
  **Do:** Run `npm test`.  
  **Expect:** All pass, including scheduleService (DST weeks, full overlapping grid, two live overlapping shifts, skip date, closed date, blocked occurrence, custom shift in now/next and coverage, custom-shift reminder de-dupe, DST-week custom shift), the route-guard test, privacy tests (incl. DOB/address/emergency contact), the quick-login on/off tests (production is off unless `QUICK_LOGIN_ENABLED` is "true" in any case; no key or cookie tests remain; a persona mapped to a non-test user is refused), and ensureTestAccounts idempotency (5 test users after two runs).

- [ ] **SYS-03 · Route-guard test** (P19, QL-2, P26, QL-5)  
  **Do:** Open the route-guard test. Look for /api/auth/quick-login*, /qa and /qa/lock.  
  **Expect:** /api/auth/quick-login* is in the route list and tagged `public:quick-login`. /qa and /qa/lock no longer exist (QL-5). The test passes because the routes are tagged, not because it was loosened (no skip, no blanket allowlist).

- [ ] **SYS-04 · Playwright smoke test** (P19, P26)  
  **Do:** Run the Playwright smoke test.  
  **Expect:** Passes end to end: sign-up → verify → complete profile → admin activates (no certification/background) → volunteer picks Tue 10–12 → admin blocks next Tue 10–12 (volunteer emailed, no reminder) → admin creates an open one-time shift → volunteer claims it → reminder logs → admin sends a message → volunteer reads it.

- [ ] **SYS-05 · Leftover search** (P21, P26, QL-4)  
  **Do:** Run `grep -rni "02928F\|027A77\|lulo\|montserrat\|Resource Coordination Program" --exclude-dir=node_modules .` then `grep -rn "applicant\|in_training" --exclude-dir=node_modules client server shared`.  
  **Expect:** The first search returns nothing. The second returns only the pg enum definition in shared/schema.ts (those values must stay in the enum) and the read-time mapping that treats them as onboarding. Nothing in shared/testAccounts.ts, UI copy, emails, or docs.

- [ ] **SYS-06 · Schema is additive** (P22, P23, P24, QL-1, QL-4)  
  **Do:** Diff shared/schema.ts against the last published version.  
  **Expect:** Only additive changes: new nullable/defaulted columns, the 'onboarding' enum value, the new tables slot_blocks, custom_shifts, custom_shift_assignments, users.isTestAccount, the 'suppressed' status. No drops, renames, type conversions, or new pg enum types.

- [ ] **SYS-07 · Config flags** (P6, P22)  
  **Do:** Open shared/appConfig.ts and shared/onboardingQuestions.ts.  
  **Expect:** trackCertificationInApp, trackBackgroundCheckInApp and requireAgreementAcknowledgment are false. minimumAge is null. onboardingQuestions exports an empty array. Identity values match P21 (appName, shortName, programName, volunteerRoleName, staffContactName Cindi, staffContactEmail, missionLine).

- [ ] **SYS-08 · Flags are reversible** (P22)  
  **Do:** In dev only: set trackBackgroundCheckInApp to true, restart, and look at the roster and a volunteer detail page. Then set it back to false and restart.  
  **Expect:** With true, the background-check badge, filter, CSV column and detail card come back. With false, all of them are gone again. (Revert before continuing.)

- [ ] **SYS-09 · Email template (log mode)** (P3, P21, P25)  
  **Do:** With no POSTMARK_SERVER_TOKEN in dev, send a test email to a non-test address (dev test route or Admin → Notifications → Send test email).  
  **Expect:** Console prints the email. A notification_log row has status `logged`. From = "The Alliance Community Care Team" <cct@defendingthecause.org>. Reply-To = cindi@defendingthecause.org. White header with logo-horizontal.png from APP_BASE_URL/brand/ over a 4px navy rule, blue button, footer with "Questions? Email Cindi at cindi@defendingthecause.org.", the mission line, and "You're receiving this because you serve with The Alliance Community Care Team." Plain-text version included.

- [ ] **SYS-10 · EMAIL_FROM / EMAIL_REPLY_TO** (P25)  
  **Do:** Set EMAIL_FROM to a malformed value and restart. Restore it. Then set EMAIL_REPLY_TO to another address and send a test email. Then unset EMAIL_REPLY_TO.  
  **Expect:** Malformed EMAIL_FROM fails startup loudly and names the secret. With EMAIL_REPLY_TO set, Reply-To uses it. Unset, Reply-To falls back to Cindi.

- [ ] **SYS-11 · Test accounts exist once** (QL-1, QL-4)  
  **Do:** Restart dev twice, then query users where isTestAccount = true.  
  **Expect:** Exactly 5 rows: qa-admin@example.org plus the 4 volunteer personas. No orphaned old vol-training / vol-applicant users.

- [ ] **SYS-12 · Job runner** (P15)  
  **Do:** Set RUN_JOBS=true in dev and watch the log for a 15-minute run, then set it back. Call POST /api/jobs/run without the JOBS_SECRET header, then with it.  
  **Expect:** The scheduler logs a run every 15 minutes only when RUN_JOBS=true. Without the header: 401/403. With it: 200 and the job runs.

- [ ] **SYS-13 · Production-mode lockdown** (P19)  
  **Do:** Run locally with NODE_ENV=production (or check on prod): open /style-guide, the dev test-email route, a page with ?at=, trigger an error, and try `npm run seed`.  
  **Expect:** /style-guide and the test route are 404. ?at= is ignored. Error responses show no stack trace. Seed refuses to run.

- [ ] **SYS-14 · Health route** (P20)  
  **Do:** GET /api/health.  
  **Expect:** Returns database and email-config status with no secret values.

- [ ] **SYS-15 · Lighthouse** (P18, P26)  
  **Do:** Run Lighthouse (mobile) accessibility on the volunteer dashboard, /onboarding, and admin home.  
  **Expect:** Each scores 95 or higher.

- [ ] **SYS-16 · Docs** (P26, QL-4, QL-5)  
  **Do:** Open DEPLOY.md, QA-CHECKLIST.md, CHANGELOG.md and QA-TEST-ACCOUNTS.md. Then run `grep -rnE "QUICK_LOGIN_KEY|qa_unlock|qa\?key|/qa/lock|Hide test logins" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=attached_assets --exclude-dir=docs .`  
  **Expect:** DEPLOY.md covers the standard grid, blocking shifts, one-time shifts, Postmark DNS, EMAIL_FROM/EMAIL_REPLY_TO (in the secrets list), and a "Quick login (testing)" section: `QUICK_LOGIN_ENABLED` true/false only, republish after changing it, Reset test accounts, turn it off before real volunteers are invited. QA-CHECKLIST.md has NEW/CHANGED tags and the quick-login items (no unlock or lock steps). CHANGELOG.md has v1.1.0 and the on/off-switch line. The grep returns nothing.

- [ ] **SYS-17 · Static brand files** (P21)  
  **Do:** List client/public/brand/ and check the response headers on /brand/logo-horizontal.png.  
  **Expect:** logo-horizontal.png, logo-stacked.png, logo-mark.png, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png are present, served as static files (not from Object Storage) with long Cache-Control headers.

- [ ] **SYS-18 · QA-CHECKLIST.md in sync (Prompt 26b)** (P26)  
  **Do:** After Prompt 26b, run `diff <(grep -oE '\b(SYS|VIS|NEW|ONBN|ONBR|ANS|ACT|ADM|MIL|NTF|PRD)-[0-9]{2}\b' "docs/Alliance Persona Test Run.md" | sort -u) <(grep -oE '\b(SYS|VIS|NEW|ONBN|ONBR|ANS|ACT|ADM|MIL|NTF|PRD)-[0-9]{2}\b' QA-CHECKLIST.md | sort -u)`.  
  **Expect:** No output: every test ID is in QA-CHECKLIST.md. No applicant, in_training, certification, background-check or agreement steps remain. MIL/NTF items are marked optional.

## VIS — Signed-out visitor

_Private/incognito window, not signed in._

- [ ] **VIS-01 · Style guide** (P1, P21)  
  **Do:** Open /style-guide in dev.  
  **Expect:** Shows navy / Alliance Blue / gray / white only, Open Sans in sentence case (no forced uppercase), buttons, inputs, badges ("good" = blue), both logos, and an email preview. No blue text on gray. Works at 375 px.

- [ ] **VIS-02 · Sign-in page brand** (P21)  
  **Do:** Open /signin at 375 px and on desktop.  
  **Expect:** No navy band. Stacked logo centered (max 240 px) above the card. Mission line in 15 px navy under the card. Gray inputs with a blue focus ring. Primary button blue, hover navy.

- [ ] **VIS-03 · Quick-login card (dev)** (QL-3, QL-4)  
  **Do:** Look below the sign-in card in dev.  
  **Expect:** Amber dashed "QUICK LOGIN — TESTING" card with 5 buttons: Admin, Volunteer · Active, Volunteer · Active, no shift, Volunteer · Onboarding, ready to activate, Volunteer · Onboarding, new. One column at 375 px, 44 px tall. No button mentions training, certification, or applicant.

- [ ] **VIS-04 · Favicon & manifest** (P18, P21)  
  **Do:** Check the browser tab, the web manifest, and Add to Home Screen on a phone.  
  **Expect:** Favicon is the circle mark. Manifest name "Community Care Team Volunteer Portal", short_name "CCT Portal", theme #06365D, background #FFFFFF, 192/512 icons. Home-screen icon uses apple-touch-icon.

- [ ] **VIS-05 · Signed-out redirects** (P5)  
  **Do:** Visit /dashboard, /shifts and /admin. Call GET /api/me and GET /api/admin/volunteers.  
  **Expect:** Pages redirect to /signin. The APIs return 401.

- [ ] **VIS-06 · Forgot password is non-revealing** (P4)  
  **Do:** Submit /forgot-password once with an unknown email and once with a real one.  
  **Expect:** Both show the same confirmation message.

- [ ] **VIS-07 · Sign-in errors & rate limit** (P4)  
  **Do:** Sign in with a wrong password repeatedly.  
  **Expect:** Generic error (doesn't say which field is wrong), then a friendly rate-limit message.

## NEW — New sign-up (real account)

_A fresh account you create in dev with an email you control (plus-addressing works). Not a test account, because test accounts never receive email. With no Postmark token in dev, emails and links print to the console. Keep this account; ADM-27 deactivates it._

- [ ] **NEW-01 · Sign-up** (P4)  
  **Do:** Go to /signup. Try a 9-character password and a mismatched confirm, then sign up properly.  
  **Expect:** Short and mismatched passwords are rejected. Intro copy shows. Account is created and you land on /verify-email with your address shown.

- [ ] **NEW-02 · Verification gate (server-enforced)** (P4)  
  **Do:** While unverified, visit /dashboard, /shifts, /onboarding, then call a protected API (e.g. GET /api/shifts) from devtools.  
  **Expect:** Every page sends you back to /verify-email. The protected API returns 401/403, not data.

- [ ] **NEW-03 · Resend rate limit** (P4)  
  **Do:** Click "Resend email" twice within a minute.  
  **Expect:** The second click is blocked with a friendly message (1/minute, 5/hour).

- [ ] **NEW-04 · Unverified sign-in** (P4)  
  **Do:** Sign out, then sign back in before verifying.  
  **Expect:** You land on /verify-email.

- [ ] **NEW-05 · Verify link** (P4, P22)  
  **Do:** Click the verification link (console in dev).  
  **Expect:** You're signed in and routed to /onboarding.

- [ ] **NEW-06 · Onboarding screen** (P22)  
  **Do:** Look over /onboarding.  
  **Expect:** One screen. Intro: "Welcome to the Community Care Team. A few details help us support you and reach someone if we ever need to." Email read-only; name and phone prefilled and editable. DOB, address, city, state (default CA), ZIP, emergency contact name / relationship (with suggestions) / phone. "Only Alliance staff can see this." under DOB and emergency contact. No questionnaire, no agreement checkbox, no county.

- [ ] **NEW-07 · Onboarding validation** (P22)  
  **Do:** Try a future DOB, a 4-digit ZIP, a short phone, and a blank required field. Then submit the same bad values straight to the API from devtools.  
  **Expect:** Each is blocked in the form and the API returns 400. ZIP+4 is accepted. Phones display as (XXX) XXX-XXXX.

- [ ] **NEW-08 · Save on blur** (P22)  
  **Do:** Fill about half the fields, then refresh.  
  **Expect:** Everything you entered is still there.

- [ ] **NEW-09 · Profile required before dashboard** (P22)  
  **Do:** Before finishing, go to /dashboard.  
  **Expect:** Redirected back to /onboarding.

- [ ] **NEW-10 · Finish onboarding** (P6, P22)  
  **Do:** Complete every field and submit.  
  **Expect:** Lands on /dashboard. Welcome email logged with "Here's what happens next: our team will reach out about training and the required paperwork. Once you're approved, you'll choose your weekly shift." Status is onboarding. Phones stored as digits only.

- [ ] **NEW-11 · Onboarding dashboard card** (P7, P22)  
  **Do:** Look at the dashboard top card.  
  **Expect:** Checklist: Account created ✓ · Profile complete ✓ · Training & paperwork (with Alliance staff) · Approval, with "We'll email you when you're ready to choose a shift." No quick-links row. No certification, background, or agreement text.

- [ ] **NEW-12 · Password reset** (P4)  
  **Do:** Sign out → Forgot password → open the reset link → set a new password → sign in. Then open the same reset link again.  
  **Expect:** Reset works and the new password signs in. The reused link fails. (Optional: a link older than 1 hour also fails.)

- [ ] **NEW-13 · Last login** (P4)  
  **Do:** Sign in, then check the roster as admin (ADM-18).  
  **Expect:** Last login shows this sign-in.

## ONBN — Volunteer · Onboarding, new

_Quick-login persona. Verified, profile fields empty._

- [ ] **ONBN-01 · Quick login** (QL-3, QL-4)  
  **Do:** Click "Volunteer · Onboarding, new".  
  **Expect:** Lands on /onboarding. Amber banner: "You're signed in as a TEST account (Volunteer · Onboarding, new). Emails to this account are not sent." The banner pushes content down and doesn't cover the top bar or bottom tabs.

- [ ] **ONBN-02 · Locked until profile done** (P22)  
  **Do:** With fields empty, visit /dashboard, /shifts and /messages.  
  **Expect:** Each redirects to /onboarding.

- [ ] **ONBN-03 · Complete profile** (QL-1, P22)  
  **Do:** Complete the profile.  
  **Expect:** Lands on /dashboard with the onboarding checklist. The welcome email shows in Admin → Notifications as `suppressed` (and prints in the dev console).

- [ ] **ONBN-04 · Reset restores persona** (QL-1)  
  **Do:** As admin, Team → Reset test accounts. Quick-login as this persona again.  
  **Expect:** Profile fields are empty again and it lands on /onboarding.

## ONBR — Volunteer · Onboarding, ready to activate

_Quick-login persona. Profile complete, waiting for staff approval._

- [ ] **ONBR-01 · Quick login** (QL-4, P22)  
  **Do:** Click "Volunteer · Onboarding, ready to activate".  
  **Expect:** Lands on /dashboard (not /onboarding). Checklist shows Profile complete ✓ and waits on Training & paperwork and Approval.

- [ ] **ONBR-02 · Can't sign up yet** (P7, P12)  
  **Do:** Open /shifts. Then POST to the shift sign-up API from devtools.  
  **Expect:** /shifts explains why sign-up isn't open yet, with no sign-up buttons. No quick-links row on the dashboard. The API returns 403.

- [ ] **ONBR-03 · Profile page** (P22)  
  **Do:** Open /profile.  
  **Expect:** Editable: name, mobile, address, emergency contact. Read-only: email, DOB, status (Onboarding), start date (blank). No county, certification, background, or agreement fields.

- [ ] **ONBR-04 · Activated by admin** (QL-4, P9, P22)  
  **Do:** Keep this signed in on device A. On device B, do ADM-22. Refresh device A.  
  **Expect:** Top card becomes "Choose your weekly shift", quick links appear, and the approval email ("You're approved! Choose your weekly shift") is logged as `suppressed`.

## ANS — Volunteer · Active, no shift

_Quick-login persona. Approved, holds no standing shift._

- [ ] **ANS-01 · Choose-shift card** (QL-3, P7)  
  **Do:** Click "Volunteer · Active, no shift".  
  **Expect:** "Choose your weekly shift" card with a primary button to /shifts. Quick-links row (Log in to Find Help, Open Phone Portal) opens each in a new tab.

- [ ] **ANS-02 · Counts only** (P12, P5)  
  **Do:** Open /shifts on desktop and at 375 px. Inspect the network responses.  
  **Expect:** Week grid on desktop, day list on mobile. Each slot shows only "1 spot open" / "Full" / "Your shift". No other volunteer's name, email or phone anywhere, including API responses.

- [ ] **ANS-03 · Sign up** (P12, P24)  
  **Do:** Sign up for Tue 10–12 starting the next Tuesday. (Also try picking a start date 3 weeks out.)  
  **Expect:** Confirmation screen and email (suppressed): "You're on the schedule: Tuesdays, 10:00 AM–12:00 PM, starting {date}." Start-date picker allows up to 4 weeks out.

- [ ] **ANS-04 · Overlap blocked** (P24)  
  **Do:** Try to add Tue 9–11 or Tue 11–1.  
  **Expect:** Blocked: "That time overlaps with your Tuesday 10:00 AM–12:00 PM shift."

- [ ] **ANS-05 · Can't drop only shift** (P12)  
  **Do:** Click Drop on the only shift.  
  **Expect:** Blocked. Offers Change shift and tells you to contact Cindi if you need to step back.

- [ ] **ANS-06 · Change shift** (P12)  
  **Do:** Change to another open slot.  
  **Expect:** The old shift ends and the new one appears. The dashboard's next-shift card updates.

- [ ] **ANS-07 · Race for last spot** (P12, P24)  
  **Do:** As admin, find (or make) a slot with exactly 1 open spot. Open it as ANS in browser A and ACT in browser B and click sign up at the same moment.  
  **Expect:** Exactly one wins. The other gets a friendly "just filled" message. The slot shows Full, never 3/2.

- [ ] **ANS-08 · Next shift & upcoming** (P7)  
  **Do:** Look at the dashboard.  
  **Expect:** "Your next shift" shows day, date and time (e.g. "Tuesday, 10:00 AM–12:00 PM"). Upcoming list shows the next 4 occurrences.

## ACT — Volunteer · Active

_Quick-login persona. In dev, starts with one standing shift after Reset test accounts._

- [ ] **ACT-01 · Quick login & banner** (QL-1, QL-3)  
  **Do:** After Reset test accounts, click "Volunteer · Active". Use Switch account in the banner, then Sign out.  
  **Expect:** Dashboard shows "Your next shift" for its one seeded shift. Switch account lists the other 4 personas and one click switches. Sign out returns to /signin.

- [ ] **ACT-02 · Layout & voice** (P7, P21)  
  **Do:** Look over the dashboard at 375 px and desktop.  
  **Expect:** White top bar with a 3 px navy border: logo-mark at 36 px on mobile, horizontal logo at 40 px on desktop. Bottom tabs Home, My Shifts, Messages, Resources, Profile, active tab blue with underline. Copy says "Resource Coordinator" for the role. No teal anywhere.

- [ ] **ACT-03 · Two-shift cap** (P12)  
  **Do:** Add a second non-overlapping standing shift, then try a third.  
  **Expect:** The second succeeds. The third is blocked with the max-2 message.

- [ ] **ACT-04 · Week off & undo** (P12)  
  **Do:** Take a week off on an occurrence more than 24 hours away, then Undo. Then try a week off on one less than 24 hours away (use ?at= in dev).  
  **Expect:** The week off removes that date from the upcoming list and Undo restores it. Inside 24 hours you get "Please contact The Alliance" with Cindi's contact.

- [ ] **ACT-05 · Week off triggers coverage gap** (P12, P13)  
  **Do:** Take a week off on an occurrence within the next 7 days (but more than 24 hours away) that leaves the slot under capacity. Then check ADM-13.  
  **Expect:** The master schedule shows this volunteer struck through with "week off", and one coverage-gap alert goes out (see ADM-13).

- [ ] **ACT-06 · One-time shifts** (P24)  
  **Do:** After ADM-11, open /shifts → One-time shifts. Claim a spot. Try one that overlaps your own shift that day. Cancel one more than 24 hours away, then try one less than 24 hours away. Try to claim a full one.  
  **Expect:** Claim works and shows in the dashboard upcoming list with a One-time tag. It doesn't count toward the 2 standing shifts. The overlapping claim is blocked. Cancel works outside 24 hours and is blocked inside it (with contact note). A full one-time shift can't be claimed.

- [ ] **ACT-07 · Inbox** (P14, P25)  
  **Do:** After ADM-16 sends this persona a single message, open /messages.  
  **Expect:** Unread dot and a nav badge. Opening it marks it read and clears the badge. Markdown renders. No reply box; the "Questions?" line names Cindi at cindi@defendingthecause.org.

- [ ] **ACT-08 · Resource hub** (P17)  
  **Do:** Open /resources. Use search and category chips. Open an article. Download a document.  
  **Expect:** Quick-link buttons at the top. Search and chips filter. Article page has clean typography. Documents download. Items unpublished in ADM-30 aren't shown.

- [ ] **ACT-09 · Downloads need sign-in** (P17)  
  **Do:** Copy a document download URL, sign out (or use a private window) and open it.  
  **Expect:** Refused (401 or sent to sign-in). Not a public URL.

- [ ] **ACT-10 · Profile edits** (P7, P22)  
  **Do:** On /profile, edit phone, address and emergency contact.  
  **Expect:** Changes save. Email, DOB, status and start date are read-only (start date filled in).

- [ ] **ACT-11 · Admin APIs blocked** (P5)  
  **Do:** From devtools, call several /api/admin/* routes. Visit /admin.  
  **Expect:** Every API returns 403. /admin redirects to /dashboard.

- [ ] **ACT-12 · Privacy in responses** (P5, P22)  
  **Do:** Inspect network responses on /dashboard, /shifts, /messages and /resources.  
  **Expect:** No other volunteer's name, email or phone. No adminNotes. No DOB, address or emergency contact for anyone except yourself.

- [ ] **ACT-13 · Reminder de-dupe for test account** (P15, P24, QL-1)  
  **Do:** After ADM-15, check this persona's reminder rows in the notification log.  
  **Expect:** One `suppressed` reminder row. Running the reminder check again adds no second row. (If it does, suppressed rows aren't counted by the de-dupe check: report it as a bug.)

- [ ] **ACT-14 · Phone & tablet walk** (P18)  
  **Do:** Walk every volunteer screen at 375 px and 768 px.  
  **Expect:** No horizontal scrolling. Tap targets at least 44 px. Dashboard usable one-handed.

## ADM — Admin

_Quick-login Test Admin. Alerts and digests are never sent to the test admin, so those checks read the notification log for the seeded dev admin (admin@example.org)._

- [ ] **ADM-01 · Quick login** (QL-3, P5)  
  **Do:** Click "Admin".  
  **Expect:** Lands on /admin with the TEST banner. Mobile nav uses a hamburger sheet.

- [ ] **ADM-02 · On shift now / Up next** (P11, P24)  
  **Do:** On admin home, use ?at= in dev: a Tuesday at 10:30 AM, a time during hours with an empty slot, and 8:00 PM.  
  **Expect:** 10:30: two groups (9–11 and 10–12), each with its own end time, names, tap-to-call phone and email. Empty slot: amber "No one is on shift right now". 8 PM: "Outside shift hours". Up next, "Updated h:mm AM" refreshing every 60 s, coverage summary, needs-attention count and recent activity all show. Test accounts carry the TEST badge.

- [ ] **ADM-03 · Load standard grid** (P24)  
  **Do:** Settings → "Load Community Care Team standard grid" → confirm. Delete two slots and click again. Click a third time.  
  **Expect:** On the seeded grid it creates 0 (all 40 exist). After deleting two, it recreates exactly those two. The third click creates none.

- [ ] **ADM-04 · Grid editor** (P10)  
  **Do:** Add a slot that overlaps another. Check the default end time. Try "Copy Monday to all weekdays" on a scratch setup.  
  **Expect:** Overlap shows an "overlaps with …" note, not an error. End time defaults to start + 2 hours. Copy fills the weekdays.

- [ ] **ADM-05 · Capacity & deactivation guards** (P10)  
  **Do:** Lower a slot's capacity below its assigned count. Deactivate a slot that has volunteers.  
  **Expect:** Capacity change is blocked with a clear message. Deactivation shows the assigned count and makes you choose keep-until-date or end now; end now emails each volunteer.

- [ ] **ADM-06 · Closed date** (P10)  
  **Do:** Add a closed date (next weekday, "Test closure"), check the schedule, then delete it.  
  **Expect:** Master schedule shows gray "Closed – Test closure". No occurrences, coverage warnings, or reminders that day. Deleting restores them.

- [ ] **ADM-07 · Master schedule view** (P11, P24)  
  **Do:** Open /admin/schedule on desktop and at 375 px. Use week navigation and Today.  
  **Expect:** Two lanes per day on a 30-minute grid; every block readable. Blocks show time, "2/2", first name + last initial. Full = white with blue accent; under capacity = gray with amber "1 open"; empty = soft amber "Open". Today highlighted. Mobile shows a day list with a day picker.

- [ ] **ADM-08 · Admin overrides** (P13)  
  **Do:** From a block's side panel: assign a volunteer past capacity, assign one past the 2-shift cap, remove a volunteer, add and remove a week off.  
  **Expect:** Searchable active-volunteer list. Over-capacity and over-cap need the Override checkbox + reason. Remove offers an optional email. All actions appear in the activity log.

- [ ] **ADM-09 · Block a shift on a date** (P24)  
  **Do:** Side panel → "Block this shift on {date}" for next Tue 10–12, reason required, email checkbox on. Then Unblock.  
  **Expect:** Shows gray "Blocked – {reason}". Assigned volunteers get "No shift on {weekday, date} — {reason}. Your regular shift continues the following week." The occurrence drops out of coverage, alerts, digest, on-shift-now/up-next and reminders. Unblock restores it.

- [ ] **ADM-10 · Block a range** (P24)  
  **Do:** Settings → Block shifts: a 2-day range with two selected slots, then a range with "all shifts".  
  **Expect:** Exactly those occurrences are blocked.

- [ ] **ADM-11 · Create one-time shift** (P24)  
  **Do:** Master schedule → "+ Add a one-time shift" (label, capacity 2, open to volunteers on). Assign one volunteer directly, then try a third past capacity.  
  **Expect:** Dashed blue border and "One-time" tag. It shows on /shifts for active volunteers (ACT-06). Exceeding capacity needs Override + reason, logged in activity.

- [ ] **ADM-12 · Cancel one-time shift** (P24)  
  **Do:** Cancel a one-time shift that has volunteers.  
  **Expect:** Confirm dialog, assigned volunteers are emailed, and it disappears from the schedule.

- [ ] **ADM-13 · Coverage-gap alert** (P13, QL-1)  
  **Do:** After ACT-05, filter the notification log by type admin_alert.  
  **Expect:** Exactly one alert per real admin (e.g. admin@example.org): "Coverage gap: {Tue Oct …}, 10:00–12:00 now has 1 of 2 volunteers (Test A. took the week off)." with a button to that week. No row for qa-admin@example.org.

- [ ] **ADM-14 · Daily digest** (P13, QL-1)  
  **Do:** With the digest toggle on and a gap in the next 7 days, trigger the digest twice the same day (job endpoint or Run now). Then remove all gaps and trigger. Then turn the toggle off and trigger.  
  **Expect:** One digest per real admin for the day (relatedId = date); none to the test admin. Nothing sent when there are no gaps, or when the toggle is off.

- [ ] **ADM-15 · Reminders** (P15, P24)  
  **Do:** Create a one-time shift starting 24 h to 24 h 15 min from now; assign ACT and a seeded dummy volunteer. /admin/notifications/jobs → Run reminder check now, twice. Also click "Send test reminder to me".  
  **Expect:** One reminder per volunteer ("Reminder: your shift tomorrow, …" with quick-link buttons and the week-off line). The second run sends nothing new. Week-off, blocked and closed-date occurrences get none. Last-run time and 7-day count update; the test reminder arrives.

- [ ] **ADM-16 · Messaging** (P14, QL-1)  
  **Do:** New message → All active volunteers, email on. Check the preview count, send. Then send a single message to Volunteer · Active. After ACT-07, reopen the sent list.  
  **Expect:** Preview count excludes test accounts and inactive volunteers. One notification_log row per recipient; the test persona's row is `suppressed`. Sent list shows "N of M read" and per-recipient receipts update after ACT reads.

- [ ] **ADM-17 · Message selected** (P8, P14)  
  **Do:** Roster → select 3 volunteers → Message selected.  
  **Expect:** Composer opens with exactly those recipients.

- [ ] **ADM-18 · Roster defaults** (P23, QL-1)  
  **Do:** Open /admin/volunteers. Toggle "Show test accounts".  
  **Expect:** Default columns: name, status, mobile (tap to call), email (tap to email), city, start date, shifts held (amber "No shift" for active with 0), last login. Test accounts hidden by default; toggled on, 5 appear with TEST badges. Summary chips exclude them either way.

- [ ] **ADM-19 · Columns, sort, layout** (P23)  
  **Do:** Use the Columns picker to show DOB, full address, ZIP, emergency contact, county. Reload. Sort by several columns. Check desktop and mobile.  
  **Expect:** Picker choice survives reload. Sorting works on every column. Sticky header and first column on desktop; stacked cards on mobile.

- [ ] **ADM-20 · Filters & chips** (P8, P23)  
  **Do:** Combine filters (e.g. Active + No shift; city + profile incomplete).  
  **Expect:** Results are the correct intersection. Chips show Onboarding / Active / Inactive counts and "Needs attention" (active with 0 shifts, incomplete profile > 7 days, onboarding > 30 days). No certification or background columns or filters.

- [ ] **ADM-21 · CSV exports** (P8, P23, P24, QL-1)  
  **Do:** Export the Roster CSV and Schedule CSV and open both in Google Sheets.  
  **Expect:** Dated filenames, open cleanly. Roster: status, start date, DOB, address, city, state, ZIP, emergency contact name/relationship/phone, county, shifts held ("Tue 10:00–12:00; …"); no certification, background, agreement or onboarding-answer columns. Schedule: one row per active assignment including one-time shifts, with upcoming skip dates. No test accounts in either.

- [ ] **ADM-22 · Activate a volunteer** (QL-4, P9, P22)  
  **Do:** Open Volunteer · Onboarding, ready to activate (show test accounts on). Move to Active (confirm). (Do this from device B during ONBR-04.)  
  **Expect:** Stepper is Onboarding → Active → Inactive. Activation works with no certification or background check. Start date is set to today. Approval email logged as suppressed. Activity log records the change.

- [ ] **ADM-23 · Activation blocked when incomplete** (P22)  
  **Do:** Open Volunteer · Onboarding, new (after a reset, before ONBN-03).  
  **Expect:** Move to Active is disabled and lists exactly which fields are missing.

- [ ] **ADM-24 · Volunteer detail page** (P9, P23)  
  **Do:** On any volunteer: edit start date inline, edit DOB and emergency contact in the Profile card, change county, type admin notes.  
  **Expect:** Profile card labeled "Visible to Alliance staff only" with tap-to-call emergency phone. County is admin-only (default Placer). Admin notes autosave. Activity log names the changed fields but never the values. No certification, background or agreement cards.

- [ ] **ADM-25 · Inactivate releases shifts** (P9, P13, P22)  
  **Do:** Move Volunteer · Active to Inactive. Then Reset test accounts.  
  **Expect:** Confirm dialog lists the shifts being released. Assignments end today. A coverage-gap alert goes to real admins. The persona's dashboard shows the gentle inactive note. Reset restores it.

- [ ] **ADM-26 · Invite admin** (P5)  
  **Do:** Team → Invite admin with an address you control. Open the invite link and set a password.  
  **Expect:** Lands on /admin already verified.

- [ ] **ADM-27 · Deactivate / reactivate** (P5)  
  **Do:** Deactivate the NEW account while it's signed in elsewhere. Try to sign in as it. Reactivate. Then try to deactivate yourself, and the last active admin (in dev).  
  **Expect:** Its open session is signed out on the next request. Sign-in shows "Your account isn't active. Please contact The Alliance." Reactivate restores access. Self-deactivation and last-admin deactivation are both blocked.

- [ ] **ADM-28 · Notification log & monthly count** (P16, QL-1)  
  **Do:** Open /admin/notifications. Compare the month count with the log filtered to sent + logged. Use filters and search. Retry a failed row. Set the monthly limit so the next send crosses 80%, send twice, then restore 100.  
  **Expect:** Count equals sent + logged (suppressed excluded), with a by-type breakdown and 6-month chart. Filters and search work; Retry resends. Crossing 80% sends one "Heads up" email to real admins; the second send doesn't repeat it.

- [ ] **ADM-29 · Postmark card** (P25)  
  **Do:** Look at the Postmark card in dev (no token).  
  **Expect:** Shows from name, from address, reply-to, token not set, and "Before sending, the defendingthecause.org DKIM and Return-Path records must show Verified in Postmark." (PRD-06 checks it with a token.)

- [ ] **ADM-30 · Resource admin** (P17)  
  **Do:** Upload a PDF and a DOCX; try a >15 MB file and a .exe. Replace a file. Write an article with live preview. Add a quick link with http:// then https://. Drag to reorder and reload. Unpublish one item.  
  **Expect:** PDF/DOCX upload; oversized and wrong-type files rejected. Replace keeps the same record. http link rejected, https accepted. Order persists. Unpublished item hidden from volunteers (ACT-08). Category autocomplete works.

- [ ] **ADM-31 · Agreement re-ack stays off** (P17, P22)  
  **Do:** If an agreement-version bump option shows, bump it. Sign in as Volunteer · Active.  
  **Expect:** No re-acknowledgment prompt for volunteers while requireAgreementAcknowledgment is false.

- [ ] **ADM-32 · Reset test accounts** (QL-1, P26)  
  **Do:** Team → Test accounts card → Reset test accounts (confirm).  
  **Expect:** Card lists 5 personas with last login. After reset: Volunteer · Active has one seeded shift (dev), others are back to defaults, their message rows are cleared, their one-time claims are cancelled (cancelledAt set). The reset is in the activity log.

- [ ] **ADM-33 · TEST badges on one-time claims** (QL-1, P26)  
  **Do:** After ACT-06, look at the one-time shift on the master schedule, its side panel, and the roster.  
  **Expect:** The test persona has the gray TEST badge in all three places.

- [ ] **ADM-34 · Phone & tablet walk** (P18)  
  **Do:** Walk every admin screen at 375 px and 768 px.  
  **Expect:** No horizontal scrolling. Tables become cards. On shift now is usable one-handed.

## MIL — Admin · Prompt 27 (optional) (optional)

_Only if Prompt 27 (milestones) is approved and built._

- [ ] **MIL-01 · Upcoming milestones card** (P27)  
  **Do:** Edit a dummy volunteer's DOB to 10 days from now and another's start date to N years ago, within 30 days. Open admin home.  
  **Expect:** "Upcoming milestones" shows the birthday as month/day only (no year or age) and "N years with the Community Care Team", each linking to the volunteer.

- [ ] **MIL-02 · Roster filter** (P27)  
  **Do:** Roster → "Milestone this month".  
  **Expect:** Shows only volunteers with a birthday or anniversary this month.

- [ ] **MIL-03 · Monday email** (P27)  
  **Do:** Trigger the milestone job as Monday 7:00 AM (?at= or job endpoint) twice. Then with no milestones. Then with the toggle off.  
  **Expect:** One email to real admins for the week (relatedId = ISO week); the rerun sends nothing. Nothing when empty or toggled off.

- [ ] **MIL-04 · Edge cases** (P27)  
  **Do:** Inactivate a volunteer with a milestone. Run `npm test`.  
  **Expect:** Inactive volunteers drop off. Date-math tests pass, including Feb 29 → Feb 28 in non-leap years.

- [ ] **MIL-05 · Test accounts in milestones** (P27, QL-1)  
  **Do:** Look for the test personas (DOB 1990-01-01) in milestones.  
  **Expect:** Not specified in Prompt 27. Decide: hidden, or shown with a TEST badge. Log what you see.

## NTF — Admin · Prompt 28 (optional) (optional)

_Only if Prompt 28 (admin shift-activity notifications) is approved and built._

- [ ] **NTF-01 · Preferences UI** (P28)  
  **Do:** Open the admin notification preferences.  
  **Expect:** Three events (standing shift sign-up, shift change, one-time claim/cancel), each Off / Instant / Daily summary, defaulting to Daily summary.

- [ ] **NTF-02 · Instant emails** (P28)  
  **Do:** Set the seeded dev admin to Instant for all. As ANS, sign up, change a shift, and claim and cancel a one-time shift.  
  **Expect:** One email per event to that admin.

- [ ] **NTF-03 · Daily summary** (P28)  
  **Do:** Set to Daily. Trigger the 5:00 PM job twice. Then on a day with no activity. Then set Off.  
  **Expect:** One summary for the day (relatedId = date); nothing on an empty day or when Off.

- [ ] **NTF-04 · Nothing else changed** (P28, P13, QL-1)  
  **Do:** Repeat ACT-05.  
  **Expect:** The coverage-gap alert still behaves as in ADM-13. Nothing is sent to the test admin.

## PRD — Production

_After the Prompt 26 publish. Quick login is on when `QUICK_LOGIN_ENABLED=true` (no unlock link since QL-5). Turn it off before real volunteers are invited._

- [ ] **PRD-01 · Enum value before publish** (P22)  
  **Do:** Before publishing Prompt 22's schema, run `ALTER TYPE volunteer_status ADD VALUE IF NOT EXISTS 'onboarding';` in the production Database tool.  
  **Expect:** Runs without error.

- [ ] **PRD-02 · Publish change list** (P22, P26)  
  **Do:** Publish and read the schema change list.  
  **Expect:** Only additive changes. If anything is dropped, renamed or converted, choose Cancel deployment. Never "Copy your development database schema & data to production".

- [ ] **PRD-03 · Status update** (P22)  
  **Do:** Run `UPDATE volunteer_profiles SET status = 'onboarding' WHERE status IN ('applicant', 'in_training');` then `SELECT status, count(*) FROM volunteer_profiles GROUP BY status;`.  
  **Expect:** No applicant or in_training rows remain.

- [ ] **PRD-04 · Health & clean data** (P20, P26)  
  **Do:** GET /api/health. Check users for admin@example.org or dummy volunteers.  
  **Expect:** Health OK. No seed data. The only @example.org users are the 5 qa-* test accounts.

- [ ] **PRD-05 · Grid in production** (P24, P26)  
  **Do:** Click "Load Community Care Team standard grid" once, then once more.  
  **Expect:** First click creates 40 slots; the second creates none.

- [ ] **PRD-06 · Live test email** (P25, P26)  
  **Do:** With the Postmark token set, send a test email to yourself and look at the Postmark card.  
  **Expect:** Arrives from The Alliance Community Care Team <cct@defendingthecause.org>, Reply-To Cindi, logo renders. Card shows token set. DKIM and Return-Path show Verified in Postmark.

- [ ] **PRD-07 · Quick login on, no unlock** (QL-3, QL-5)  
  **Do:** With `QUICK_LOGIN_ENABLED=true` in Secrets (republished), open /signin in a fresh private window.  
  **Expect:** The quick-login card shows right away, with the amber TEST ACCOUNTS pill, the red PRODUCTION pill, and 5 buttons. No unlock step and no "Hide test logins on this device" link.

- [ ] **PRD-08 · Old unlock routes gone** (QL-5)  
  **Do:** Open /qa?key=anything and /qa/lock.  
  **Expect:** The normal not-found page. Quick login works the same before and after.

- [ ] **PRD-09 · All 5 personas** (P26, QL-4)  
  **Do:** Sign in as each persona.  
  **Expect:** Admin → /admin. Active → next-shift card (or choose-shift if it has none). Active, no shift → choose-shift card. Onboarding, ready → dashboard checklist. Onboarding, new → /onboarding.

- [ ] **PRD-10 · Reset after prod testing** (QL-1)  
  **Do:** If any persona took a shift, Team → Reset test accounts. Check the master schedule.  
  **Expect:** Prod Volunteer · Active starts with no shift after reset, and any capacity used in testing is freed.

- [ ] **PRD-11 · Turn quick login off** (QL-2, QL-5)  
  **Do:** When prod testing is done (and before the first pilot invites): set `QUICK_LOGIN_ENABLED=false`, republish, open /signin in a fresh window, and call GET /api/auth/quick-login/status.  
  **Expect:** No quick-login card. The status call returns 404. Normal sign-in still works.

- [ ] **PRD-12 · External cron** (P15, P13)  
  **Do:** Watch /admin/notifications/jobs for 30+ minutes. On a weekday after 7 AM, check the log for the digest.  
  **Expect:** Last-run time updates every 15 minutes from the external cron. The 7 AM digest is logged if there are gaps (tracker A4, A6).

- [ ] **PRD-13 · Production lockdown** (P20, P19)  
  **Do:** Restart logs; open /style-guide; add ?at= to admin home.  
  **Expect:** Startup secrets check passes. /style-guide is 404. ?at= is ignored.

## Coverage by prompt

Every prompt's Check maps to at least one test.

| Prompt | Tests |
|---|---|
| P1 | VIS-01 |
| P2 | SYS-01 |
| P3 | SYS-09 |
| P4 | VIS-06, VIS-07, NEW-01, NEW-02, NEW-03, NEW-04, NEW-05, NEW-12, NEW-13 |
| P5 | VIS-05, ANS-02, ACT-11, ACT-12, ADM-01, ADM-26, ADM-27 |
| P6 | SYS-07, NEW-10 |
| P7 | NEW-11, ONBR-02, ANS-01, ANS-08, ACT-02, ACT-10 |
| P8 | ADM-17, ADM-20, ADM-21 |
| P9 | ONBR-04, ADM-22, ADM-24, ADM-25 |
| P10 | SYS-02, ADM-04, ADM-05, ADM-06 |
| P11 | ADM-02, ADM-07 |
| P12 | ONBR-02, ANS-02, ANS-03, ANS-05, ANS-06, ANS-07, ACT-03, ACT-04, ACT-05 |
| P13 | ACT-05, ADM-08, ADM-13, ADM-14, ADM-25, NTF-04, PRD-12 |
| P14 | ACT-07, ADM-16, ADM-17 |
| P15 | SYS-12, ACT-13, ADM-15, PRD-12 |
| P16 | ADM-28 |
| P17 | ACT-08, ACT-09, ADM-30, ADM-31 |
| P18 | SYS-15, VIS-04, ACT-14, ADM-34 |
| P19 | SYS-02, SYS-03, SYS-04, SYS-13, PRD-13 |
| P20 | SYS-14, PRD-04, PRD-13 |
| P21 | SYS-05, SYS-09, SYS-17, VIS-01, VIS-02, VIS-04, ACT-02 |
| P22 | SYS-01, SYS-06, SYS-07, SYS-08, NEW-05, NEW-06, NEW-07, NEW-08, NEW-09, NEW-10, NEW-11, ONBN-02, ONBN-03, ONBR-01, ONBR-03, ONBR-04, ACT-10, ACT-12, ADM-22, ADM-23, ADM-25, ADM-31, PRD-01, PRD-02, PRD-03 |
| P23 | SYS-06, ADM-18, ADM-19, ADM-20, ADM-21, ADM-24 |
| P24 | SYS-01, SYS-02, SYS-06, ANS-03, ANS-04, ANS-07, ACT-06, ACT-13, ADM-02, ADM-03, ADM-07, ADM-09, ADM-10, ADM-11, ADM-12, ADM-15, ADM-21, PRD-05 |
| P25 | SYS-09, SYS-10, ACT-07, ADM-29, PRD-06 |
| P26 | SYS-02, SYS-03, SYS-04, SYS-05, SYS-15, SYS-16, SYS-18, ADM-32, ADM-33, PRD-02, PRD-04, PRD-05, PRD-06, PRD-09 |
| P27 | MIL-01, MIL-02, MIL-03, MIL-04, MIL-05 |
| P28 | NTF-01, NTF-02, NTF-03, NTF-04 |
| QL-1 | SYS-02, SYS-06, SYS-11, ONBN-03, ONBN-04, ACT-01, ACT-13, ADM-13, ADM-14, ADM-16, ADM-18, ADM-21, ADM-28, ADM-32, ADM-33, MIL-05, NTF-04, PRD-10 |
| QL-2 | SYS-02, SYS-03, PRD-11 |
| QL-3 | VIS-03, ONBN-01, ANS-01, ACT-01, ADM-01, PRD-07 |
| QL-4 | SYS-05, SYS-06, SYS-11, SYS-16, VIS-03, ONBN-01, ONBR-01, ONBR-04, ADM-22, PRD-09 |
| QL-5 | SYS-02, SYS-03, SYS-16, PRD-07, PRD-08, PRD-11 |

## Superseded v1 checks

| Prompt | Original check | Now tested as |
|---|---|---|
| P1 | Teal labels use #027A77; Lulo Clean / Montserrat display font | P21 replaced teal with Alliance Blue #0175aa and moved to Open Sans only. Now: no teal or Lulo anywhere (SYS-05, VIS-01). |
| P2 | Seed with 4 applicant / 3 in_training; Mon–Fri 4-shift grid | P22 status model and P24 40-slot grid (SYS-01). |
| P6 | Edit a question in onboardingQuestions.ts and the form follows | P22 empties the questions; the section is hidden (SYS-07). Fixed profile fields tested in NEW-06 to NEW-10. |
| P7 | Top card for applicant / in_training | P22 onboarding checklist (NEW-11, ONBR-01). |
| P9 | Can't activate without a cleared background check | P22 removed the gate: activation needs only verified email + complete profile (ADM-22, ADM-23). |
| P17 | Agreement version bump prompts re-acknowledgment | Off while requireAgreementAcknowledgment = false (ADM-31). |
| P20 | Migrations run with drizzle-kit migrate | Oct 10 decision: schema reaches prod through Replit Publish (PRD-01 to PRD-03). |
| QL-1 / QL-3 | Personas vol-training and vol-applicant; buttons "In training" / "Applicant" | QL-4 replaced them with the two Onboarding personas (VIS-03, ONBN, ONBR). |
| QL-2 / QL-3 | Production lock: `QUICK_LOGIN_KEY`, the `/qa?key=` unlock with a 30-day cookie, `/qa/lock`, "Hide test logins on this device"; prod 404 until unlocked | QL-5 (Oct 10) removed all of it. Production quick login is on/off with `QUICK_LOGIN_ENABLED` only (SYS-02, SYS-03, SYS-16, PRD-07, PRD-08, PRD-11). |

## Keeping this current

- **This doc is the master test list.** Any new or changed build prompt gets its tests added here (and to the .xlsx) in the same session.
- **Prompt 26b** (Build Prompts v2) has Replit merge this doc into QA-CHECKLIST.md after Prompt 26, with test IDs on each step. SYS-18 checks it.
- **Prompts 27 and 28** each end with a line telling Replit to add their workflows to QA-CHECKLIST.md, so the file stays current if they're built.
- After any later prompt, upload the updated version of this doc to `docs/` in Replit so QA-CHECKLIST.md can be re-synced.
