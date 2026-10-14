# Alliance Volunteer App — Persona Test Run (Prompts 1–28 + Oct 11 fixes)

Hayes Strategy Group · Oct 10, 2026 · Updated Oct 14, 2026 · Built from every **Check** line in Build Prompts v1 (1–20), the Quick Login addendum (QL-1 to QL-5), Build Prompts v2 (21–28) and Build Prompts v3 (Fix 1–3, Oct 11). Same rows are in `Alliance Persona Test Run.xlsx` for the UAT Google Sheet.

**What this tests:** the finished app after Prompt 26 and the v3–v5 fixes (plus 27–28 if built). Where a later prompt changed an earlier Check, the test is written for the final behavior. The changed checks are listed under *Superseded v1 checks* at the end.

**Oct 14 update (v9, Oct 14 UI review with Tiffany):** Build Prompts v9: Fix 9 (v1.2.1) makes the admin menu scroll on phones, switches the home-screen icon to the Community Care Team stacked logo, and makes sign-out always land on the official sign-in page; Fix 10 (v1.3.0) adds hour logging after each shift (new table volunteer_hours); Fix 11 (v1.4.0) adds Admin → Reports (hours per Resource Coordinator and team hours per month, with CSVs). Added ACT-16, ACT-17, ACT-18, ADM-41, ADM-42, ADM-43, ADM-44, PRD-17 and PRD-18. Updated VIS-04, ADM-01, SYS-04, SYS-06, ADM-32 and ADM-34. Password minimum confirmed at 8 characters (no change). This version goes up to `docs/` with v9 Step 2. Test count: 145.

**Oct 13 update (v8, Tiffany's Oct 13 decisions):** Build Prompts v8 Fix 8 (v1.2.0): volunteers become Active automatically when they finish their profile (no staff approval gate), becoming Active always sets a start date (B17), an admin-only background check record (checkbox + date), a minimum age of 18, and the old .replit.app address forwarding to the official address. Added NEW-14, ADM-40, PRD-15 and PRD-16. Updated SYS-04, SYS-07, SYS-08, SYS-18, NEW-10, NEW-11, ONBN-03, ONBR-01, ONBR-02, ADM-20, ADM-21, ADM-22, ADM-23 and ADM-24, plus the ONBR persona description. This version goes up to `docs/` with v8 Step 3. Test count: 136.

**Oct 12 update (v7, Reminder jobs page):** added ADM-39 and updated PRD-12 for Build Prompts v7 Fix 7 (v1.1.5): plain-language scheduler status, a warning when scheduled runs stop, and the last scheduled run shown separately from manual checks. This version went up to `docs/` with v7 Step 1. Later Oct 12: v1.1.5 published; ADM-39 passed (Drew, dev) and PRD-12 passed in production (Claude); ADM-39's optional stale-warning step now records a scheduled run first (Replit's clarification).

**Oct 12 update (v1.1.4):** ADM-20, ADM-22 and ADM-23 updated for the guided volunteer review (Awaiting review badge, approval checklist, Approve as Active); ACT-14 and ADM-34 now check the shared page header. Not yet in Replit's docs/ copy; it goes up with the next build prompt. Test IDs are unchanged, so SYS-18 still passes.

**Oct 12 update (D0a, Replit's 13 differences):** Synced with the "Master/app disagreements" list at the bottom of QA-CHECKLIST.md (v1.1.3). Updated to match how the app actually works: SYS-01, SYS-05, SYS-08, SYS-09, SYS-10, SYS-11, SYS-12, SYS-17, SYS-18, VIS-03, NEW-01, ADM-03, ADM-15, PRD-03 and PRD-05. Already matched (fixed Oct 11, so no change): the Community Care Team contact checks (ANS-05, ACT-04, ACT-07, PRD-06) and ADM-18. No new bugs: the one real gap (SYS-08, the roster's background-check badge and filter) is accepted while tracking stays off (C8). MIL/NTF stay optional and aren't built. This version is re-uploaded to `docs/` by Build Prompts v6.

**Oct 11 update (v5 / v1.1.3):** ACT-10, ADM-04, ADM-24, ADM-25 and PRD-06 updated for Fix 5 (synced with Replit's docs/ copy). SYS-13 expectation corrected to match how the app blocks dev features (not-found page / 403).

**Oct 11 update (v4):** added ADM-38; VIS-08 and ADM-37 updated for Fix 4 (manifest.json, singular capacity copy).

**Oct 11 update:** added VIS-08, ACT-15, ADM-35–37 and PRD-14 for the v3 fixes; updated NEW-07, ONBN-02 and ACT-08. Volunteer-facing contact checks now expect the Community Care Team (cct@defendingthecause.org) instead of Cindi, per Prompt 25 (SYS-07, SYS-09, SYS-10, ANS-05, ACT-04, ACT-07, PRD-06).

**How this relates to QA-CHECKLIST.md:** that file lives in Replit. Prompt 19 created it, Prompt 26 and 26b updated it, and each later prompt adds its own items. Use this doc as the master list, and re-upload it to `docs/` in Replit when it changes.

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
| VIS | Signed-out visitor | Private/incognito window, not signed in. | Dev | 8 |
| NEW | New sign-up (real account) | A fresh account you create in dev with an email you control (plus-addressing works). Not a test account, because test accounts never receive email. With no Postmark token in dev, emails and links print to the console. Keep this account; ADM-27 deactivates it. | Dev | 14 |
| ONBN | Volunteer · Onboarding, new | Quick-login persona. Verified, profile fields empty. | Dev | 4 |
| ONBR | Volunteer · Onboarding, ready to activate | Quick-login persona. Profile complete but still Onboarding: since v1.2.0 this is the manual case (someone who finished before automatic activation, or was moved back to Onboarding by staff). | Dev | 4 |
| ANS | Volunteer · Active, no shift | Quick-login persona. Approved, holds no standing shift. | Dev | 8 |
| ACT | Volunteer · Active | Quick-login persona. In dev, starts with one standing shift after Reset test accounts. | Dev | 18 |
| ADM | Admin | Quick-login Test Admin. Alerts and digests are never sent to the test admin, so those checks read the notification log for the seeded dev admin (admin@example.org). | Dev | 44 |
| MIL | Admin · Prompt 27 (optional) | Only if Prompt 27 (milestones) is approved and built. | Dev | 5 |
| NTF | Admin · Prompt 28 (optional) | Only if Prompt 28 (admin shift-activity notifications) is approved and built. | Dev | 4 |
| PRD | Production | After the Prompt 26 publish. Quick login is on when `QUICK_LOGIN_ENABLED=true` (no unlock link since QL-5). | Prod | 18 |

## SYS — Developer / system

_Replit shell + dev URL. No sign-in. Tests, seed, grep, config, jobs, Lighthouse, docs._

- [ ] **SYS-01 · Seed** (P2, P22, P24)  
  **Do:** Run `npm run seed` twice.  
  **Expect:** Both runs finish with no errors and no duplicates. The seed itself creates 1 admin and 18 dummy volunteers (these counts don't include the 5 QA test accounts, which are created separately; count `users` and `volunteer_profiles` separately, since they aren't the same rows). Statuses are onboarding / active / inactive only (none applicant or in_training), and there are 40 shift slots (Mon–Fri × 9–11, 10–12, 11–1, 12–2, 1–3, 2–4, 3–5, 4–6, capacity 2).

- [ ] **SYS-02 · Automated tests** (P10, P19, P24, P26, QL-1, QL-2, QL-5)  
  **Do:** Run `npm test`.  
  **Expect:** All pass, including scheduleService (DST weeks, full overlapping grid, two live overlapping shifts, skip date, closed date, blocked occurrence, custom shift in now/next and coverage, custom-shift reminder de-dupe, DST-week custom shift), the route-guard test, privacy tests (incl. DOB/address/emergency contact), the quick-login on/off tests (production is off unless `QUICK_LOGIN_ENABLED` is "true" in any case; no key or cookie tests remain; a persona mapped to a non-test user is refused), and ensureTestAccounts idempotency (5 test users after two runs).

- [ ] **SYS-03 · Route-guard test** (P19, QL-2, P26, QL-5)  
  **Do:** Open the route-guard test. Look for /api/auth/quick-login*, /qa and /qa/lock.  
  **Expect:** /api/auth/quick-login* is in the route list and tagged `public:quick-login`. /qa and /qa/lock no longer exist (QL-5). The test passes because the routes are tagged, not because it was loosened (no skip, no blanket allowlist).

- [ ] **SYS-04 · Playwright smoke test** (P19, P26, F8, F10, F11)  
  **Do:** Run the Playwright smoke test.  
  **Expect:** Passes end to end: sign-up → verify → complete profile → automatically Active (no admin activation step since v1.2.0; no certification/background) → volunteer picks Tue 10–12 → admin blocks next Tue 10–12 (volunteer emailed, no reminder) → admin creates an open one-time shift → volunteer claims it → reminder logs → admin sends a message → volunteer reads it → admin records Background check complete with a date and the roster's Background check filter finds the volunteer → after the volunteer's shift has passed (dev clock), the volunteer taps "Confirm 2 hours" on Home → the admin sees 2 hours on the volunteer's page and in Reports for that month (v1.3.0–v1.4.0).

- [ ] **SYS-05 · Leftover search** (P21, P26, QL-4)  
  **Do:** Search the app source, skipping dependencies, build output, migrations, `docs/` and the separate `artifacts/mockup-sandbox`: `grep -rniE "02928F|027A77|lulo|montserrat|Resource Coordination Program" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=migrations artifacts/alliance-volunteer-portal artifacts/api-server shared lib/db` then `grep -rnE "applicant|in_training" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=migrations artifacts/alliance-volunteer-portal artifacts/api-server shared lib/db`.  
  **Expect:** No old colors, fonts or program name in any screen or email. applicant / in_training appear only in the database enum definition (lib/db, those values must stay) and the read-time mapping that treats them as onboarding (shared/legacy-compatibility.ts). Any other hit (for example a deliberate email alias kept for compatibility) is reviewed and explained, not an automatic fail. Nothing in shared/testAccounts.ts, UI copy or emails.

- [ ] **SYS-06 · Schema is additive** (P22, P23, P24, QL-1, QL-4, F10)  
  **Do:** Diff shared/schema.ts against the last published version.  
  **Expect:** Only additive changes: new nullable/defaulted columns, the 'onboarding' enum value, the new tables slot_blocks, custom_shifts, custom_shift_assignments and volunteer_hours (v1.3.0: source as text with a CHECK, not a new enum), users.isTestAccount, the 'suppressed' status. No drops, renames, type conversions, or new pg enum types.

- [ ] **SYS-07 · Config flags** (P6, P22, P25, F8)  
  **Do:** Open shared/appConfig.ts and shared/onboardingQuestions.ts. Run `grep -rni cindi --exclude-dir=node_modules artifacts shared`.  
  **Expect:** trackCertificationInApp, trackBackgroundCheckInApp and requireAgreementAcknowledgment are false. trackBackgroundCheckAdminOnly and autoActivateOnProfileComplete are true, and minimumAge is 18 (v1.2.0). onboardingQuestions exports an empty array. Identity values match P21, and the volunteer-facing contact is the Community Care Team (cct@defendingthecause.org). The grep finds no volunteer-facing Cindi references.

- [ ] **SYS-08 · Flags are reversible** (P22, F8)  
  **Do:** In dev only. (a) Set trackBackgroundCheckAdminOnly to false, restart, and look at a volunteer detail page, the roster filters and Columns picker, and the Roster CSV; set it back to true. (b) Set autoActivateOnProfileComplete to false, restart, and complete the profile as Volunteer · Onboarding, new; set it back to true and Reset test accounts. (c) Set minimumAge to null, restart, and try a date of birth 17 years ago; set it back to 18.  
  **Expect:** (a) With false (and trackBackgroundCheckInApp false), the Background check card, filter, column and CSV columns are all gone; with true they're back. (b) With false, finishing the profile leaves the volunteer in Onboarding with the old welcome email ("Once you're approved…") and the onboarding checklist; with true, they're Active right away. (c) With null, the 17-year-old date is accepted; with 18 it's refused. trackBackgroundCheckInApp (the old volunteer-facing, approval-gating version) stays false; turning it on is a change order. (Revert everything before continuing.)

- [ ] **SYS-09 · Email template (log mode)** (P3, P21, P25)  
  **Do:** With no POSTMARK_SERVER_TOKEN in dev, send a test email to a non-test address (dev test route or Admin → Notifications → Send test email).  
  **Expect:** Console prints the email. A notification_log row has status `logged`. From = "The Alliance Community Care Team" <cct@defendingthecause.org>. Reply-To = EMAIL_REPLY_TO if set, otherwise the sender address (cct@defendingthecause.org). White header with logo-horizontal.png from APP_BASE_URL/brand/ over a 4px navy rule, blue button, footer pointing questions to the Community Care Team (cct@defendingthecause.org), the mission line, and "You're receiving this because you serve with The Alliance Community Care Team." No mention of Cindi. Plain-text version included.

- [ ] **SYS-10 · EMAIL_FROM / EMAIL_REPLY_TO** (P25)  
  **Do:** Set EMAIL_FROM to a malformed value and start the app in production mode (NODE_ENV=production); then try a send in dev. Restore it. Then set EMAIL_REPLY_TO to another address and send a test email. Then unset EMAIL_REPLY_TO.  
  **Expect:** In production mode a malformed EMAIL_FROM stops startup with a clear error that names the secret. In dev, startup isn't checked, but the send is refused with a clear error. With EMAIL_REPLY_TO set, Reply-To uses it. Unset, Reply-To falls back to the sender address (cct@defendingthecause.org).

- [ ] **SYS-11 · Test accounts exist once** (QL-1, QL-4)  
  **Do:** Restart dev twice, then query users where isTestAccount = true.  
  **Expect:** Exactly 5 user rows with isTestAccount = true (qa-admin@example.org plus the 4 volunteer personas) and 4 matching volunteer profiles (the test admin has none). No orphaned old vol-training / vol-applicant users.

- [ ] **SYS-12 · Job runner** (P15)  
  **Do:** Set RUN_JOBS=true in dev and watch the log for a 15-minute run, then set it back. Call POST /api/jobs/run with no `X-Jobs-Secret` header, then with `X-Jobs-Secret` set to the JOBS_SECRET value.  
  **Expect:** The scheduler logs a run every 15 minutes only when RUN_JOBS=true. Without the header: 401/403. With it: 200 and the job runs. `X-Jobs-Secret` is the only header accepted (sending the secret under any other header name, such as JOBS_SECRET, is refused).

- [ ] **SYS-13 · Production-mode lockdown** (P19)  
  **Do:** Run locally with NODE_ENV=production (or check on prod): open /style-guide, the dev test-email route, a page with ?at=, trigger an error, and try `npm run seed`.  
  **Expect:** /style-guide shows the app's not-found page (the single-page app may return HTTP 200) and the dev test-email route is blocked (403 ROUTE_NOT_DECLARED or 404); neither dev feature works. ?at= is ignored. Error responses show no stack trace. Seed refuses to run.

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
  **Do:** List artifacts/alliance-volunteer-portal/public/brand/ and check the response headers on /brand/logo-horizontal.png.  
  **Expect:** logo-horizontal.png, logo-stacked.png, logo-mark.png, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png are present, served as static files (not from Object Storage) with long Cache-Control headers.

- [ ] **SYS-18 · QA-CHECKLIST.md in sync (Prompt 26b)** (P26)  
  **Do:** After the D0a re-upload (Build Prompts v6), run `diff <(grep -oE '\b(SYS|VIS|NEW|ONBN|ONBR|ANS|ACT|ADM|MIL|NTF|PRD)-[0-9]{2}\b' "docs/Alliance Persona Test Run.md" | sort -u) <(grep -oE '\b(SYS|VIS|NEW|ONBN|ONBR|ANS|ACT|ADM|MIL|NTF|PRD)-[0-9]{2}\b' QA-CHECKLIST.md | sort -u)` and read the "Master/app disagreements" section of QA-CHECKLIST.md.  
  **Expect:** No diff output: every test ID is in QA-CHECKLIST.md. The disagreements section lists none still open (only the MIL/NTF note that those optional features aren't built). No applicant, in_training, certification or agreement steps remain; the only background-check steps are the admin-only record (ADM-40, SYS-07, SYS-08). MIL/NTF items are marked optional.

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
  **Expect:** Amber dashed "Quick login — testing" card (sentence case, per the CCT brand) with 5 buttons: Admin, Volunteer · Active, Volunteer · Active, no shift, Volunteer · Onboarding, ready to activate, Volunteer · Onboarding, new. One column at 375 px, 44 px tall. No button mentions training, certification, or applicant.

- [ ] **VIS-04 · Favicon & home-screen icon** (P18, P21, F9)  
  **Do:** Check the browser tab and /manifest.json. On a phone, remove any earlier portal icon, then Add to Home Screen.  
  **Expect:** Favicon is still the circle mark. Manifest name "Community Care Team Volunteer Portal", short_name "CCT Portal", theme #06365D, background #FFFFFF, icons icon-192.png and icon-512.png (purpose any) plus icon-512-maskable.png (purpose maskable), each with ?v=2. The home-screen icon (apple-touch-icon) is the Community Care Team stacked logo (The Alliance script with "COMMUNITY CARE TEAM" in blue) on white, not the circle mark (v1.2.1).

- [ ] **VIS-05 · Signed-out redirects** (P5)  
  **Do:** Visit /dashboard, /shifts and /admin. Call GET /api/me and GET /api/admin/volunteers.  
  **Expect:** Pages redirect to /signin. The APIs return 401.

- [ ] **VIS-06 · Forgot password is non-revealing** (P4)  
  **Do:** Submit /forgot-password once with an unknown email and once with a real one.  
  **Expect:** Both show the same confirmation message.

- [ ] **VIS-07 · Sign-in errors & rate limit** (P4)  
  **Do:** Sign in with a wrong password repeatedly.  
  **Expect:** Generic error (doesn't say which field is wrong), then a friendly rate-limit message.

- [ ] **VIS-08 · Google button & manifest type** (F3)  
  **Do:** With Google sign-in not configured, open /signin. Check the response headers of /manifest.json (renamed from /manifest.webmanifest in v1.1.2).  
  **Expect:** No "Continue with Google" button (`/api/auth/session` reports googleEnabled: false). The manifest is served as JSON (`application/json` or `application/manifest+json`), not `text/plain` and not the app's HTML page.

## NEW — New sign-up (real account)

_A fresh account you create in dev with an email you control (plus-addressing works). Not a test account, because test accounts never receive email. With no Postmark token in dev, emails and links print to the console. Keep this account; ADM-27 deactivates it._

- [ ] **NEW-01 · Sign-up** (P4)  
  **Do:** Go to /signup. Try a 7-character password and a mismatched confirm, then sign up properly (8+ characters).  
  **Expect:** The 7-character password (minimum is 8) and the mismatched confirm are rejected. Intro copy shows. Account is created and you land on /verify-email with your address shown.

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

- [ ] **NEW-07 · Onboarding validation** (P22, F2)  
  **Do:** Try a future DOB, a 4-digit ZIP, a short phone, and a blank required field. Then send the same bad values straight to the API from devtools, including a partial `PATCH /api/onboarding` with just `{"zip":"9560"}` or `{"phone":"12345"}`.  
  **Expect:** Each is blocked in the form, and the API returns 400 with field errors, including for the partial PATCH (empty values are still allowed for save-as-you-go). ZIP+4 is accepted. Phones display as (XXX) XXX-XXXX.

- [ ] **NEW-08 · Save on blur** (P22)  
  **Do:** Fill about half the fields, then refresh.  
  **Expect:** Everything you entered is still there.

- [ ] **NEW-09 · Profile required before dashboard** (P22)  
  **Do:** Before finishing, go to /dashboard.  
  **Expect:** Redirected back to /onboarding.

- [ ] **NEW-10 · Finish onboarding** (P6, P22, F8)  
  **Do:** Complete every field and submit.  
  **Expect:** Lands on /dashboard with the "Choose your weekly shift" card ("You're all set. Pick the weekly shift that fits your life."). Status is Active right away with today's start date (v1.2.0: no staff approval step). One welcome email is logged: "Welcome to the Community Care Team: choose your weekly shift", with a "Choose your weekly shift" button to /shifts. Recent activity on the admin page shows the automatic status change. Phones stored as digits only.

- [ ] **NEW-11 · Dashboard after onboarding** (P7, P22, F8)  
  **Do:** Look at the dashboard top card and the quick links.  
  **Expect:** "Choose your weekly shift" card with a button to /shifts, and the Log in to Find Help / Open Phone Portal quick-link buttons. No onboarding checklist, and no certification, background, training-and-paperwork, approval or agreement text.

- [ ] **NEW-12 · Password reset** (P4)  
  **Do:** Sign out → Forgot password → open the reset link → set a new password → sign in. Then open the same reset link again.  
  **Expect:** Reset works and the new password signs in. The reused link fails. (Optional: a link older than 1 hour also fails.)

- [ ] **NEW-13 · Last login** (P4)  
  **Do:** Sign in, then check the roster as admin (ADM-18).  
  **Expect:** Last login shows this sign-in.

- [ ] **NEW-14 · Minimum age 18** (F8)  
  **Do:** On /onboarding (a fresh account, or Volunteer · Onboarding, new after a reset), enter a date of birth one day short of 18 years ago and try to finish. Send the same value to `PATCH /api/onboarding` from devtools. Then use a date exactly 18 years ago today. As admin, try to change a volunteer's DOB to one day short of 18 years ago.  
  **Expect:** The form shows the hint "You must be 18 or older to serve as a Resource Coordinator." The under-18 date is refused in the form and by the API (400) with "Resource Coordinators must be 18 or older. If your date of birth is correct, please contact the Community Care Team at cct@defendingthecause.org." Exactly 18 today is accepted. The admin edit is refused with "Date of birth must be at least 18 years ago."

## ONBN — Volunteer · Onboarding, new

_Quick-login persona. Verified, profile fields empty._

- [ ] **ONBN-01 · Quick login** (QL-3, QL-4)  
  **Do:** Click "Volunteer · Onboarding, new".  
  **Expect:** Lands on /onboarding. Amber banner: "You're signed in as a TEST account (Volunteer · Onboarding, new). Emails to this account are not sent." The banner pushes content down and doesn't cover the top bar or bottom tabs.

- [ ] **ONBN-02 · Locked until profile done** (P22, F2)  
  **Do:** With fields empty, visit /dashboard, /shifts, /messages, /resources and /profile.  
  **Expect:** Each redirects to /onboarding. (Failed in production on Oct 11 for /shifts, which showed "Your profile is awaiting approval" instead; fixed by v3 Fix 2.)

- [ ] **ONBN-03 · Complete profile** (QL-1, P22, F8)  
  **Do:** Complete the profile.  
  **Expect:** Lands on /dashboard with the "Choose your weekly shift" card: the persona is Active right away (v1.2.0). The welcome email ("Welcome to the Community Care Team: choose your weekly shift") shows in Admin → Notifications as `suppressed` (and prints in the dev console). Reset test accounts afterwards.

- [ ] **ONBN-04 · Reset restores persona** (QL-1)  
  **Do:** As admin, Team → Reset test accounts. Quick-login as this persona again.  
  **Expect:** Profile fields are empty again and it lands on /onboarding.

## ONBR — Volunteer · Onboarding, ready to activate

_Quick-login persona. Profile complete but still Onboarding: since v1.2.0 this is the manual case (someone who finished before automatic activation, or was moved back to Onboarding by staff)._

- [ ] **ONBR-01 · Quick login** (QL-4, P22, F8)  
  **Do:** Click "Volunteer · Onboarding, ready to activate".  
  **Expect:** Lands on /dashboard (not /onboarding). The card shows Account created ✓ and Profile complete ✓, then "Your profile is complete. The Community Care Team will turn on shift sign-up for you. Questions? Contact the Community Care Team at cct@defendingthecause.org." No Training & paperwork or Approval rows (v1.2.0).

- [ ] **ONBR-02 · Can't sign up yet** (P7, P12, F8)  
  **Do:** Open /shifts. Then POST to the shift sign-up API from devtools.  
  **Expect:** /shifts explains "Your account isn't active yet. The Community Care Team will turn on shift sign-up for you…", with no sign-up buttons. No quick-links row on the dashboard. The API returns 403.

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

- [ ] **ANS-05 · Can't drop only shift** (P12, P25)  
  **Do:** Click Drop on the only shift.  
  **Expect:** Blocked. Offers Change shift and tells you to contact the Community Care Team (cct@defendingthecause.org) if you need to step back.

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
  **Expect:** Dashboard shows "Your next shift" for its one seeded shift. Switch account lists the other 4 personas and one click switches (cross-role switching: ADM-35). Sign out returns to /signin.

- [ ] **ACT-02 · Layout & voice** (P7, P21)  
  **Do:** Look over the dashboard at 375 px and desktop.  
  **Expect:** White top bar with a 3 px navy border: logo-mark at 36 px on mobile, horizontal logo at 40 px on desktop. Bottom tabs Home, My Shifts, Messages, Resources, Profile, active tab blue with underline. Copy says "Resource Coordinator" for the role. No teal anywhere.

- [ ] **ACT-03 · Two-shift cap** (P12)  
  **Do:** Add a second non-overlapping standing shift, then try a third.  
  **Expect:** The second succeeds. The third is blocked with the max-2 message.

- [ ] **ACT-04 · Week off & undo** (P12, P25)  
  **Do:** Take a week off on an occurrence more than 24 hours away, then Undo. Then try a week off on one less than 24 hours away (use ?at= in dev).  
  **Expect:** The week off removes that date from the upcoming list and Undo restores it. Inside 24 hours you get "Please contact The Alliance" with the Community Care Team contact (cct@defendingthecause.org).

- [ ] **ACT-05 · Week off triggers coverage gap** (P12, P13)  
  **Do:** Take a week off on an occurrence within the next 7 days (but more than 24 hours away) that leaves the slot under capacity. Then check ADM-13.  
  **Expect:** The master schedule shows this volunteer struck through with "week off", and one coverage-gap alert goes out (see ADM-13).

- [ ] **ACT-06 · One-time shifts** (P24)  
  **Do:** After ADM-11, open /shifts → One-time shifts. Claim a spot. Try one that overlaps your own shift that day. Cancel one more than 24 hours away, then try one less than 24 hours away. Try to claim a full one.  
  **Expect:** Claim works and shows in the dashboard upcoming list with a One-time tag. It doesn't count toward the 2 standing shifts. The overlapping claim is blocked. Cancel works outside 24 hours and is blocked inside it (with contact note). A full one-time shift can't be claimed.

- [ ] **ACT-07 · Inbox** (P14, P25)  
  **Do:** After ADM-16 sends this persona a single message, open /messages.  
  **Expect:** Unread dot and a nav badge. Opening it marks it read and clears the badge. Markdown renders. No reply box; the "Questions?" line names the Community Care Team (cct@defendingthecause.org).

- [ ] **ACT-08 · Resource hub** (P17, F2)  
  **Do:** Open /resources. Use search and category chips. Open an article. Download a document. (Dev: also delete one document's file from storage and try again.)  
  **Expect:** Quick-link buttons at the top. Search and chips filter. Article page has clean typography. Documents download. Items unpublished in ADM-30 aren't shown. A document whose file is missing returns "This document isn't available right now." (404), never a 500, and shows a "File missing" warning on /admin/resources.

- [ ] **ACT-09 · Downloads need sign-in** (P17)  
  **Do:** Copy a document download URL, sign out (or use a private window) and open it.  
  **Expect:** Refused (401 or sent to sign-in). Not a public URL.

- [ ] **ACT-10 · Profile edits** (P7, P22)  
  **Do:** On /profile, edit phone, address and emergency contact. Read the hint under Email and find the Email address section below; compare the hint on /onboarding.  
  **Expect:** Changes save. The read-only Email field says "To change your email, use Email address below." Self-service email changes require verification. Onboarding keeps its staff-contact hint. DOB, status and start date stay read-only (start date filled in).

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
  **Expect:** No horizontal scrolling. Tap targets at least 44 px. Dashboard usable one-handed. Every page uses the same page header (title, subtitle, actions), and long titles and action buttons wrap cleanly at 375 px (v1.1.4).

- [ ] **ACT-15 · Dashboard cards readable** (F2)  
  **Do:** View the dashboard as Volunteer · Active, no shift (choose-shift card) and as Volunteer · Active with a shift (next-shift card), at 375 px and desktop. Run the axe contrast check.  
  **Expect:** The "Choose your weekly shift" heading and the next-shift date line are white on navy and clearly readable. No contrast failures. (Both were navy on navy in production on Oct 11.)


- [ ] **ACT-16 · Sign out on the official address** (F9)  
  **Do:** Close every portal tab and clear site data for cct.defendingthecause.org and the old .replit.app address (or use a private window). Quick-login as Volunteer · Active on the official address, open the round user menu → Sign out. Press Back, then open /dashboard. Repeat as Admin. (In dev, use the dev URL.)  
  **Expect:** Sign-out lands on /signin of the official address (v1.2.1: replace navigation, React Query cache cleared). Back and /dashboard both end on /signin; no signed-in page flashes. The user menu closes. (Tiffany's Oct 14 issue: sign-out flashed and returned to the dashboard, most likely from a tab still open on the old address.)

- [ ] **ACT-17 · Log hours after a shift** (F10)  
  **Do:** After Reset test accounts, quick-login as Volunteer · Active. Note its standing shift's first date on My Shifts, then open /dashboard with ?at= set 5 minutes after that shift ends (dev only). Tap "Confirm 2 hours". Then open My Shifts → Past shifts.  
  **Expect:** Before the shift ends there's no "Log your hours" card. After, Home shows "Log your hours" with "Thanks for your shift! Confirm the hours you served." and the shift ("Mon, Oct 19 · 9:00 AM–11:00 AM"). Confirm 2 hours saves it ("Logged: 2 hours ✓"), the card disappears, and "Your hours this month: 2" shows. Past shifts lists it as "2 hours logged" with Edit. Recent activity on the admin page shows "hours logged". Onboarding personas never see hours.

- [ ] **ACT-18 · Changing hours and the limits** (F10)  
  **Do:** On Past shifts, Edit the logged shift to 2.5 with a note. Try 0, 0.3 and 13. From devtools, PUT /api/volunteer/hours for a shift that hasn't ended, for another slot the persona doesn't hold, and for this shift with ?at= 15 days after it. Use "Different hours" on a new unlogged shift (move ?at= a week on) and enter 1.5.  
  **Expect:** 2.5 with the note saves and updates the same entry. 0, 0.3 and 13 are refused with "Enter hours between 0.25 and 12, in quarter hours (for example 1.5)." The API refuses (422) the future shift, the other slot and the 15-day-old shift ("You can only log hours for your own shifts from the last 14 days…"). After 14 days the shift is read-only with the note "You can log or change hours for 14 days after a shift. For older shifts, contact the Community Care Team at cct@defendingthecause.org." 1.5 saves. No email is sent for any of this.

## ADM — Admin

_Quick-login Test Admin. Alerts and digests are never sent to the test admin, so those checks read the notification log for the seeded dev admin (admin@example.org)._

- [ ] **ADM-01 · Quick login** (QL-3, P5, F9, F11)  
  **Do:** Click "Admin". On a phone-width screen, open the ☰ menu.  
  **Expect:** Lands on /admin with the TEST banner. Mobile nav uses a hamburger sheet listing every admin page, including Reports after Volunteers (11 items since v1.4.0); see ADM-41 for scrolling.

- [ ] **ADM-02 · On shift now / Up next** (P11, P24)  
  **Do:** On admin home, use ?at= in dev: a Tuesday at 10:30 AM, a time during hours with an empty slot, and 8:00 PM.  
  **Expect:** 10:30: two groups (9–11 and 10–12), each with its own end time, names, tap-to-call phone and email. Empty slot: amber "No one is on shift right now". 8 PM: "Outside shift hours". Up next, "Updated h:mm AM" refreshing every 60 s, coverage summary, needs-attention count and recent activity all show. Test accounts carry the TEST badge.

- [ ] **ADM-03 · Load standard grid** (P24)  
  **Do:** Settings → "Load Community Care Team standard grid" → confirm, on the seeded grid. Click it again. Then in an isolated dev setup with no shift slots, click it twice.  
  **Expect:** On the seeded grid it creates 0 (all 40 exist), and again 0. On the empty grid the first click creates 40 and the second creates 0. The slot editor deactivates slots rather than deleting them; a deactivated slot still counts as existing, so the loader doesn't recreate it (reactivate it in the editor instead).

- [ ] **ADM-04 · Grid editor** (P10)  
  **Do:** Open a new slot and check its capacity and default end time. Edit an existing slot with a different capacity. Add a slot that overlaps another. Try "Copy Monday to all weekdays" on a scratch setup.  
  **Expect:** New slots default to capacity 2 (matching the standard grid); existing capacities are kept. Overlap shows an "overlaps with …" note, not an error. End time defaults to start + 2 hours. Copy fills the weekdays.

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
  **Do:** Create a one-time shift that starts within the next 24 hours (e.g. 3 hours from now); assign ACT and a seeded dummy (non-test) volunteer. /admin/notifications/jobs → Run reminder check now, twice. Signed in as a real dev admin (admin@example.org, not the Test Admin), click "Send test reminder to me".  
  **Expect:** The manual check catches up on every shift starting within the next 24 hours: one reminder per volunteer ("Reminder: your shift tomorrow, …" or today's date, with quick-link buttons and the week-off line), logged for the dummy volunteer and `suppressed` for ACT. The second run sends nothing new. Week-off, blocked and closed-date occurrences get none. Last-run time and 7-day count update. The test reminder is logged for the real admin (from the Test Admin it would be `suppressed`).

- [ ] **ADM-16 · Messaging** (P14, QL-1)  
  **Do:** New message → All active volunteers, email on. Check the preview count, send. Then send a single message to Volunteer · Active. After ACT-07, reopen the sent list.  
  **Expect:** Preview count excludes test accounts and inactive volunteers. One notification_log row per recipient; the test persona's row is `suppressed`. Sent list shows "N of M read" and per-recipient receipts update after ACT reads.

- [ ] **ADM-17 · Message selected** (P8, P14)  
  **Do:** Roster → select 3 volunteers → Message selected.  
  **Expect:** Composer opens with exactly those recipients.

- [ ] **ADM-18 · Roster defaults** (P23, QL-1)  
  **Do:** Open /admin/volunteers. Toggle "Show test accounts".  
  **Expect:** Default columns: name, status, mobile (tap to call), email (tap to email), city, start date, shifts held (amber "No shift" for active with 0), last login. Test accounts hidden by default; toggled on, the 4 volunteer personas appear with TEST badges (the test admin is on Team). Summary chips exclude them either way.

- [ ] **ADM-19 · Columns, sort, layout** (P23)  
  **Do:** Use the Columns picker to show DOB, full address, ZIP, emergency contact, county. Reload. Sort by several columns. Check desktop and mobile.  
  **Expect:** Picker choice survives reload. Sorting works on every column. Sticky header and first column on desktop; stacked cards on mobile.

- [ ] **ADM-20 · Filters & chips** (P8, P23, v1.1.4, F8)  
  **Do:** Use the Needs attention filter with each reason (Not active yet, No shift, Profile incomplete for more than 7 days, Onboarding for more than 30 days) and the Background check filter (Complete, Not recorded), then combine filters (e.g. Active + No shift; city + Not active yet; Active + Background check Not recorded). Export the Roster and Schedule CSVs with a reason and a background-check filter selected.  
  **Expect:** Results are the correct intersection. Chips show Onboarding / Active / Inactive counts and "Needs attention". Every Onboarding volunteer shows a "Not active yet" badge (renamed from "Awaiting review" in v1.2.0), alongside any other reasons (active with 0 shifts, incomplete profile > 7 days in onboarding, onboarding > 30 days). The CSV exports use the same filters. No certification columns, filters or reasons, and no background-check Needs-attention reason.

- [ ] **ADM-21 · CSV exports** (P8, P23, P24, QL-1, F8)  
  **Do:** Export the Roster CSV and Schedule CSV and open both in Google Sheets.  
  **Expect:** Dated filenames, open cleanly. Roster: status, start date, DOB, address, city, state, ZIP, emergency contact name/relationship/phone, county, shifts held ("Tue 10:00–12:00; …"); "Background check complete" (Yes/No) and "Background check date" columns (v1.2.0); no certification, agreement or onboarding-answer columns. Schedule: one row per active assignment including one-time shifts, with upcoming skip dates. No test accounts in either.

- [ ] **ADM-22 · Activate a volunteer by hand** (QL-4, P9, P22, v1.1.4, F8)  
  **Do:** After Reset test accounts, open Volunteer · Onboarding, ready to activate (show test accounts on). Read the Activation panel, then click Approve as Active → Confirm approval as Active. (Do this from device B during ONBR-04.)  
  **Expect:** The panel is headed "Activation", with the note "Volunteers become Active on their own when they finish their profile. Use Approve as Active only for someone who's still Onboarding with a complete profile." The checklist says "Ready to activate", shows every requirement as Complete and "Pending: Staff approval as Active". The dialog is titled "Approve as Active?" and says the approval email is attempted after saving. Activation works with no certification or background check. Start date is set to today, even though this test volunteer was approved before (B17, fixed in v1.2.0). The result says the approval email wasn't sent (test-account delivery suppressed) and it's logged as suppressed. The roster, overview and Needs attention update without a reload. Activity log records the change.

- [ ] **ADM-23 · Activation blocked when incomplete** (P22, v1.1.4, F8)  
  **Do:** Open Volunteer · Onboarding, new (after a reset, before ONBN-03).  
  **Expect:** The Activation panel's checklist says "Waiting on volunteer requirements" and lists each missing item (Onboarding completed and each empty profile field) with who completes it and a link to the right section, plus "Message volunteer about missing steps". Approve as Active isn't offered. If approval is attempted through the API, it returns 422 with the missing items listed.

- [ ] **ADM-24 · Volunteer detail page** (P9, P23, F8)  
  **Do:** On any volunteer: change only the start date inline and look at Recent activity; then save the start date together with another profile field. Edit DOB, emergency contact, county and admin notes.  
  **Expect:** A start-date-only edit creates one "Start date changed" entry, with no duplicate "Profile updated" entry. Mixed edits list only the other field names in "Profile updated", never values. Profile card is staff-only with tap-to-call emergency phone; county is admin-only (default Placer); notes autosave. No certification or agreement cards; the staff-only Background check card is tested in ADM-40.

- [ ] **ADM-25 · Inactivate releases shifts** (P9, P13, P22)  
  **Do:** Move Volunteer · Active (with a shift) to Inactive. Without reloading, look at Current shifts, Standing shifts and dates, and the master schedule. Then Reset test accounts.  
  **Expect:** Confirm dialog lists the shifts being released. Assignments end today; both shift lists clear immediately (no stale Mark week off buttons) and the master week refreshes. A coverage-gap alert goes to real admins if a released shift is within 14 days. The persona's dashboard shows the gentle inactive note. Reset restores it.

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
  **Expect:** Shows from name, from address, reply-to (cct@defendingthecause.org), token not set, and "Before sending, the defendingthecause.org DKIM and Return-Path records must show Verified in Postmark." (PRD-06 checks it with a token.)

- [ ] **ADM-30 · Resource admin** (P17)  
  **Do:** Upload a PDF and a DOCX; try a >15 MB file and a .exe. Replace a file. Write an article with live preview. Add a quick link with http:// then https://. Drag to reorder and reload. Unpublish one item.  
  **Expect:** PDF/DOCX upload; oversized and wrong-type files rejected. Replace keeps the same record. http link rejected, https accepted. Order persists. Unpublished item hidden from volunteers (ACT-08). Category autocomplete works.

- [ ] **ADM-31 · Agreement re-ack stays off** (P17, P22)  
  **Do:** If an agreement-version bump option shows, bump it. Sign in as Volunteer · Active.  
  **Expect:** No re-acknowledgment prompt for volunteers while requireAgreementAcknowledgment is false.

- [ ] **ADM-32 · Reset test accounts** (QL-1, P26, F10)  
  **Do:** Team → Test accounts card → Reset test accounts (confirm).  
  **Expect:** Card lists 5 personas with last login. After reset: Volunteer · Active has one seeded shift (dev), others are back to defaults, their message rows are cleared, their one-time claims are cancelled (cancelledAt set), and their logged hours are deleted (v1.3.0). The reset is in the activity log. All test sessions are signed out, including the admin doing the reset. Real (non-test) records are untouched.

- [ ] **ADM-33 · TEST badges on one-time claims** (QL-1, P26)  
  **Do:** After ACT-06, look at the one-time shift on the master schedule, its side panel, and the roster.  
  **Expect:** The test persona has the gray TEST badge in all three places.

- [ ] **ADM-34 · Phone & tablet walk** (P18, F11)  
  **Do:** Walk every admin screen at 375 px and 768 px.  
  **Expect:** No horizontal scrolling. Tables become cards. On shift now is usable one-handed. Every admin page uses the same page header, with actions wrapping under the title on narrow screens (v1.1.4). Reports (v1.4.0) shows its tiles stacked and the hours table as cards at 375 px. On desktop at 1280 px the admin top bar fits on one line (My Profile moves to the user menu only).

- [ ] **ADM-35 · Switch account across roles** (QL-3, F2)  
  **Do:** From the test-account banner, switch volunteer → Admin, Admin → volunteer, volunteer → volunteer, and onboarding-new → Admin. Start each switch from a different page (e.g. /profile, /admin/team).  
  **Expect:** Each switch lands on the right home page for the new persona (/admin, /dashboard or /onboarding) with no stuck "Taking you to the right place" spinner. (Failed in production on Oct 11 for cross-role switches; fixed by v3 Fix 2.)

- [ ] **ADM-36 · Shift email type** (F2)  
  **Do:** As ANS, book a shift, take a week off, and claim then cancel a one-time shift. Open /admin/notifications and filter by type.  
  **Expect:** Those emails are logged as type "Shift" (not "Welcome"). The welcome and "You're approved" emails stay "Welcome". The filter, monthly by-type counts and 6-month chart all include Shift.

- [ ] **ADM-37 · Polish pass** (F3)  
  **Do:** Book a shift that starts next week and look at My Shifts. Put both Active personas on the schedule. Open the master schedule and admin home with `?at=` set to a Saturday. Check the volunteer Profile card with a screen reader or the accessibility tree. Look at the Team → Test accounts card, message recipient search, and the slot editor capacity helper.  
  **Expect:** "Starts {date}" for a future start ("Started" only once it has passed). The two Active personas are distinguishable (persona labels, TEST badge). On a weekend the schedule and "This week" show the coming week. Profile card labels are linked to their inputs, and every phone shows as (XXX) XXX-XXXX. Team card labels match the sign-in buttons. Test accounts carry TEST in message search. Capacity helper reads "1 volunteer is assigned, so capacity can't go below 1." for one, and "{N} volunteers are assigned…" for more; the server error uses the same singular/plural.

- [ ] **ADM-38 · Week off only inside the assignment period** (F4)  
  **Do:** Give an Active persona a standing shift with a start date 15+ days out. Open that shift in the Master schedule side panel. Try marking a week off before the start date through the API.  
  **Expect:** The panel lists only dates on or after the start date (plus any stored future weeks off), with no "Mark week off" for earlier weeks. The API returns 422 ("That date is before this volunteer's standing shift starts."). The volunteer's own week-off action rejects out-of-period dates the same way. Reset test accounts afterwards.

- [ ] **ADM-39 · Reminder jobs page explains the scheduler** (F7)  
  **Do:** In dev with RUN_JOBS off and no JOBS_SECRET, open Admin → Reminder jobs. Click Run reminder check now. Optional: set a 32+ character JOBS_SECRET, restart, record one scheduled run (POST /api/jobs/run with the X-Jobs-Secret header), then wait 20+ minutes without calling the job (remove the secret afterwards). Without a recorded scheduled run the page correctly shows "No scheduled run has been recorded yet." instead of the stale warning.  
  **Expect:** The Scheduler row says "Not scheduled" (amber) and the top notice says reminders aren't scheduled. No "Automatic scheduler" or "External trigger" rows and no autoscale note. After the manual check, Last run shows "Manual (Run reminder check now)" with a "Last scheduled run" line (or "No scheduled run yet"). Count tiles read Due, Sent, Logged (not delivered), Failed, Skipped, Test accounts (not sent), Carried to next run, Unconfirmed. With JOBS_SECRET set, the Scheduler row says cron-job.org, and after 20 minutes with no scheduled run the notice turns red ("No scheduled run in the last 20 minutes…").

- [ ] **ADM-40 · Background check record (admin-only)** (F8)  
  **Do:** Open Volunteer · Active. In the Background check card, tick "Background check complete" and try to save with no date, then with tomorrow's date, then with last Friday. Look at Recent activity. On the roster, filter Background check → Complete, then Not recorded; add the Background check column from Columns and sort by it. Export the Roster CSV. Quick-login as Volunteer · Active and look at Home and Profile. Back as admin, untick the box. Reset test accounts.  
  **Expect:** Save is refused with no date and with a future date ("Enter the date the background check was completed (today or earlier)."); last Friday saves. Recent activity lists the changed field names only, never values. The Complete filter shows the volunteer and Not recorded doesn't (the reverse after unticking). The column shows "Complete · {date}" or "Not recorded" and sorts. The CSV has Background check complete = Yes and the date. The volunteer sees nothing about background checks. Unticking clears the date. It never blocks activation (ADM-22 works without it) and adds no Needs-attention reason. After the reset it's Not recorded.


- [ ] **ADM-41 · Admin menu on a phone** (F9, F11)  
  **Do:** On a real phone (and in the dev preview at 320×568 and 375×667), quick-login as Admin and open ☰. Scroll the menu and tap the last item (Resources). Open it again, press Escape (desktop) or the close button.  
  **Expect:** The sheet fills the visible screen and the item list scrolls on its own (the page behind doesn't move). Every item can be reached and tapped, including Resources, which the iPhone home indicator doesn't cover; 11 items since v1.4.0 (Reports after Volunteers). Tap targets are at least 44 px. Closing works and focus returns to the ☰ button. (Tiffany's Oct 14 issue: on her phone the menu didn't scroll and cut off Resources.)

- [ ] **ADM-42 · Hours on a volunteer's page** (F10)  
  **Do:** After ACT-17/ACT-18, open Volunteer · Active as Admin → Hours card. Add hours: a past date with no shift → Other time, 1 hour, note "Training"; then the persona's logged shift again (duplicate); then a future date. Edit the Other entry to 1.5, then Delete it. Look at Recent activity. As a volunteer, call GET /api/admin/volunteers/{id}/hours from devtools.  
  **Expect:** The card shows "This month: {N} hours · Last month: {N} hours" and the last 90 days: the volunteer's entry ("Volunteer"), unlogged past shifts as amber "Not logged" with Log hours. Other time needs a note; it saves as entered by your admin name. The duplicate is refused ("Hours are already logged for that shift…") and the future date is refused ("Hours can't be logged for a future date."). Edit and Delete (with "Remove these hours?") work. Recent activity lists hours logged / updated / deleted with the hours. The volunteer gets 403.

- [ ] **ADM-43 · Reports: monthly hours** (F11)  
  **Do:** After ACT-17, open Admin → Reports. Turn Show test accounts on, then off. Use Previous / Next. Open /admin/reports with ?at= a week after the logged shift so the next shift has ended unlogged. Click "Message volunteers with unlogged shifts" (don't send). Click a name.  
  **Expect:** Title "Volunteer hours" with the month (current month by default; Next disabled on it). With test accounts on: Team hours 2 (or the logged total), Resource Coordinators who logged hours 1, Shifts logged 1, and the persona's row (hours, shifts logged, other time, not logged, last logged) with a totals row; off: the test persona disappears and the tiles count real volunteers only. Shifts not logged yet shows 1 in amber with the button, which opens the composer with exactly that volunteer selected. "Team hours by month" lists 12 months with bars. The name opens the volunteer's page. An empty month says "No hours have been logged for {Month YYYY} yet." Volunteers get 403 on /api/admin/reports/*.

- [ ] **ADM-44 · Reports: CSV exports** (F11)  
  **Do:** On Reports (test accounts on), download "hours by volunteer" and "all hour entries", and open both in Google Sheets. Repeat with test accounts off.  
  **Expect:** Files named alliance-hours-by-volunteer-YYYY-MM.csv and alliance-hour-entries-YYYY-MM.csv open cleanly. By volunteer: Volunteer, Email, Status, Hours logged, Shifts logged, Other time entries, Shifts not logged, Last logged, plus a Team total row matching the page. Entries: Date, Volunteer, Shift ("Mon 09:00–11:00", a one-time label or "Other time"), Hours, Entered by, Note, Last changed. With test accounts off, no test persona rows.

## MIL — Admin · Prompt 27 (optional)

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

## NTF — Admin · Prompt 28 (optional)

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

_After the Prompt 26 publish. Quick login is on when `QUICK_LOGIN_ENABLED=true` (no unlock link since QL-5). Turn it off before real volunteers are invited. While production still has seed data (before PRD-14), avoid anything that emails the @example.org dummies or admin@example.org through Postmark._

- [ ] **PRD-01 · Enum value before publish** (P22)  
  **Do:** Before publishing Prompt 22's schema, run `ALTER TYPE volunteer_status ADD VALUE IF NOT EXISTS 'onboarding';` in the production Database tool.  
  **Expect:** Runs without error.

- [ ] **PRD-02 · Publish change list** (P22, P26, F2)  
  **Do:** Publish and read the schema change list. (For Fix 2, run `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'shift';` first.)  
  **Expect:** Only additive changes. If anything is dropped, renamed or converted, choose Cancel deployment. Never "Copy your development database schema & data to production".

- [ ] **PRD-03 · Status update** (P22)  
  **Do:** Only with Drew's approval (one-time step, done Oct 11 after the Prompt 22 publish, tracker A8c): run `SELECT status, count(*) FROM volunteer_profiles GROUP BY status;`. If applicant or in_training rows show up, ask before running `UPDATE volunteer_profiles SET status = 'onboarding' WHERE status IN ('applicant', 'in_training');`.  
  **Expect:** No applicant or in_training rows. (Even if some existed, the app reads them as onboarding, so nothing breaks while waiting for approval.)

- [ ] **PRD-04 · Health & clean data** (P20, P26, F1)  
  **Do:** GET /api/health. Check users for admin@example.org or dummy volunteers.  
  **Expect:** Health OK. No seed data. The only @example.org users are the 5 qa-* test accounts. (Failed on Oct 11: production had the full dev seed. PRD-14 cleans it up.)

- [ ] **PRD-05 · Grid in production** (P24, P26)  
  **Do:** Click "Load Community Care Team standard grid" once, then once more.  
  **Expect:** The first click fills in only the standard slots that don't exist yet (20 after the Fix 1 purge, which kept 4 existing times; 40 on an empty grid). Deactivated slots count as existing and aren't recreated. The second click creates none.

- [ ] **PRD-06 · Live test email** (P25, P26)  
  **Do:** In production, sign in as yourself (a real admin). Admin → Notifications → "Send test email to me"; Reminder jobs → "Send test reminder to me". Repeat as the test Admin.  
  **Expect:** Both buttons show and send only to the signed-in admin (logged sent). From the test Admin they log suppressed and deliver nothing. Volunteers and signed-out users can't call them. Email arrives from The Alliance Community Care Team <cct@defendingthecause.org> with the configured Reply-To and the logo. Card shows token set; DKIM and Return-Path show Verified in Postmark.

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

- [ ] **PRD-12 · External cron** (P15, P13, F7)  
  **Do:** Open Admin → Reminder jobs and watch it for 30+ minutes. Click Run reminder check now once. On a weekday after 7 AM, check Schedule settings → "Last daily check" and the log for the digest.  
  **Expect:** The top notice is green ("Scheduled runs are on time. Last one at {time}") and the time is under 15 minutes old, updating on its own every 15 minutes. The Scheduler row says "cron-job.org (outside service), every 15 minutes" with a green badge; Last run source is "Scheduled (cron-job.org)". After the manual click, Last run shows Manual, the "Last scheduled run" line still shows the cron-job.org run, and the notice stays green. On weekdays the daily check runs after 7 AM and the digest is logged if there are gaps (tracker A4, A6). "No daily check yet" over a weekend is expected.

- [ ] **PRD-13 · Production lockdown** (P20, P19)  
  **Do:** Restart logs; open /style-guide; add ?at= to admin home.  
  **Expect:** Startup secrets check passes. /style-guide is 404. ?at= is ignored.

- [ ] **PRD-14 · Seed data purge** (F1)  
  **Do:** After your real admin exists, run the Fix 1 pre-checks, the numbered statements in order, and the post-checks in the production Database tool. Then open the roster (test accounts on and off), master schedule, email log and /resources, and quick-login as all 5 personas.  
  **Expect:** The pre-check shows at least 1 active admin not on example.org; then 19 users to delete and 5 qa-* users. Every statement succeeds. The post-checks are 0 for non-test @example.org users, profiles, assignments, messages, resources and notification rows, with qa-* users = 5 and shift_slots unchanged. The roster only has the test personas, the schedule has no names, the email log has no dummy rows, /resources is empty, and quick login works.

- [ ] **PRD-15 · v1.2.0 in production** (F8)  
  **Do:** Publish Fix 8 and read the schema change list. Reset test accounts. As Volunteer · Onboarding, new, enter a date of birth 17 years ago (refused), then finish the profile with a valid one. As Admin, open that persona; then on Volunteer · Active record a background check with last Friday's date, check the roster's Background check filter, and untick it. Approve Volunteer · Onboarding, ready to activate. Reset test accounts.  
  **Expect:** The publish lists no schema changes. The under-18 date is refused with the 18-or-older message. The new persona becomes Active right away with today's start date, and its welcome email ("Welcome to the Community Care Team: choose your weekly shift") is suppressed. The background check saves, filters and clears. The ready persona gets today's start date on approval. After the reset every persona is back to its default.

- [ ] **PRD-16 · Official address** (A13i, F8)  
  **Do:** After `APP_BASE_URL` is set to https://cct.defendingthecause.org, the republish and the cron-job.org URL change: open https://cct.defendingthecause.org, then https://the-alliance-cct.replit.app/signin. Quick-login as Admin on the new address and save a small change (add and remove a word in a test volunteer's admin notes). Signed in as yourself, Notifications → Send test email to me. Check cron-job.org and Admin → Reminder jobs. Reset test accounts.  
  **Expect:** The new address loads with valid HTTPS. The old address lands on the same page at the new address. Sign-in and saves work there. The test email's logo and links use cct.defendingthecause.org. cron-job.org shows success on the new URL, and Reminder jobs shows "Scheduled runs are on time" within 15 minutes.


- [ ] **PRD-17 · v1.2.1 on a real phone** (F9)  
  **Do:** After the v9 publish, on your phone open https://cct.defendingthecause.org, quick-login as Admin and open ☰; tap the last item. Remove any earlier portal icon from the home screen and add it again. Sign out from the user menu.  
  **Expect:** Every admin menu item is reachable (ADM-41). The new home-screen icon is the Community Care Team stacked logo (VIS-04). Sign-out lands on /signin (ACT-16).

- [ ] **PRD-18 · v1.3.0–v1.4.0 in production** (F10, F11)  
  **Do:** Publish and read the schema change list. In the production Database tool, one statement at a time: `SELECT count(*) FROM volunteer_hours;` and `SELECT conname FROM pg_constraint WHERE conrelid = 'volunteer_hours'::regclass ORDER BY conname;`. As Admin, on Volunteer · Active → Hours → Add hours: the last weekday, Other time, 2 hours, note "Production check"; edit it to 1.5. Open Reports with Show test accounts on and off; download both CSVs. Reset test accounts.  
  **Expect:** The publish lists exactly one new table, volunteer_hours, and nothing dropped, renamed or changed. The count is 0; the constraint list shows the primary key, the foreign keys and the CHECKs for source, hours and the source/shift pairing (if a CHECK is missing, the app still validates; record it). The entry saves and edits. Reports shows 1.5 team hours with test accounts on and 0 with them off; the CSVs match. After the reset the persona's hours are gone. Volunteer-side logging (ACT-17) is checked in production once the first real pilot shifts end.

## Coverage by prompt

Every prompt's Check maps to at least one test. F1–F3 are the Oct 11 fixes in Build Prompts v3; F4 is v4; F7 is v7 (Reminder jobs page); F8 is v8 (Tiffany's Oct 13 decisions, v1.2.0); F9–F11 are v9 (Oct 14 UI review: phone menu, icon and sign-out v1.2.1; hour logging v1.3.0; Reports v1.4.0).

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
| P25 | SYS-07, SYS-09, SYS-10, ANS-05, ACT-04, ACT-07, ADM-29, PRD-06 |
| P26 | SYS-02, SYS-03, SYS-04, SYS-05, SYS-15, SYS-16, SYS-18, ADM-32, ADM-33, PRD-02, PRD-04, PRD-05, PRD-06, PRD-09 |
| P27 | MIL-01, MIL-02, MIL-03, MIL-04, MIL-05 |
| P28 | NTF-01, NTF-02, NTF-03, NTF-04 |
| QL-1 | SYS-02, SYS-06, SYS-11, ONBN-03, ONBN-04, ACT-01, ACT-13, ADM-13, ADM-14, ADM-16, ADM-18, ADM-21, ADM-28, ADM-32, ADM-33, MIL-05, NTF-04, PRD-10 |
| QL-2 | SYS-02, SYS-03, PRD-11 |
| QL-3 | VIS-03, ONBN-01, ANS-01, ACT-01, ADM-01, ADM-35, PRD-07 |
| QL-4 | SYS-05, SYS-06, SYS-11, SYS-16, VIS-03, ONBN-01, ONBR-01, ONBR-04, ADM-22, PRD-09 |
| QL-5 | SYS-02, SYS-03, SYS-16, PRD-07, PRD-08, PRD-11 |
| F1 | PRD-04, PRD-14 |
| F2 | NEW-07, ONBN-02, ACT-08, ACT-15, ADM-35, ADM-36, PRD-02 |
| F3 | VIS-08, ADM-37 |
| F4 | VIS-08, ADM-37, ADM-38 |
| F7 | ADM-39, PRD-12 |
| F8 | SYS-04, SYS-07, SYS-08, SYS-18, NEW-10, NEW-11, NEW-14, ONBN-03, ONBR-01, ONBR-02, ADM-20, ADM-21, ADM-22, ADM-23, ADM-24, ADM-40, PRD-15, PRD-16 |
| F9 | VIS-04, ADM-01, ACT-16, ADM-41, PRD-17 |
| F10 | SYS-04, SYS-06, ADM-32, ACT-17, ACT-18, ADM-42, PRD-18 |
| F11 | SYS-04, ADM-01, ADM-34, ADM-41, ADM-43, ADM-44, PRD-18 |

## Superseded v1 checks

| Prompt | Original check | Now tested as |
|---|---|---|
| P1 | Teal labels use #027A77; Lulo Clean / Montserrat display font | P21 replaced teal with Alliance Blue #0175aa and moved to Open Sans only. Now: no teal or Lulo anywhere (SYS-05, VIS-01). |
| P2 | Seed with 4 applicant / 3 in_training; Mon–Fri 4-shift grid | P22 status model and P24 40-slot grid (SYS-01). |
| P6 | Edit a question in onboardingQuestions.ts and the form follows | P22 empties the questions; the section is hidden (SYS-07). Fixed profile fields tested in NEW-06 to NEW-10. |
| P7 | Top card for applicant / in_training | P22 onboarding checklist (NEW-11, ONBR-01). |
| P9 | Can't activate without a cleared background check | P22 removed the gate: activation needs only verified email + complete profile (ADM-22, ADM-23). |
| P22 / v1.1.4 | Volunteers wait in Onboarding for staff approval; the welcome email says "Once you're approved…"; the dashboard shows Training & paperwork and Approval; roster badge "Awaiting review" | F8 (Oct 13): volunteers become Active automatically when they finish their profile (NEW-10, NEW-11, ONBN-03); Approve as Active stays for the manual case (ONBR-01, ADM-22); badge "Not active yet" (ADM-20). |
| P22 | minimumAge null; no background-check tracking (C8) | F8: minimum age 18 (NEW-14); admin-only background check record, not a gate (ADM-40, SYS-07, SYS-08). |
| P18 / P21 | Home-screen icon is the circle mark (apple-touch-icon) | F9 (Oct 14): the Community Care Team stacked logo on white; favicon stays the circle mark (VIS-04, PRD-17). |
| P17 | Agreement version bump prompts re-acknowledgment | Off while requireAgreementAcknowledgment = false (ADM-31). |
| P20 | Migrations run with drizzle-kit migrate | Oct 10 decision: schema reaches prod through Replit Publish (PRD-01 to PRD-03). |
| P21 | Cindi (staffContactName/Email) is the volunteer-facing contact and default Reply-To | P25 made the Community Care Team (cct@defendingthecause.org) the volunteer contact and Reply-To; Cindi is staff-only (SYS-07, SYS-09, SYS-10, ANS-05, ACT-04, ACT-07, PRD-06). |
| QL-1 / QL-3 | Personas vol-training and vol-applicant; buttons "In training" / "Applicant" | QL-4 replaced them with the two Onboarding personas (VIS-03, ONBN, ONBR). |
| QL-2 / QL-3 | Production lock: `QUICK_LOGIN_KEY`, the `/qa?key=` unlock with a 30-day cookie, `/qa/lock`, "Hide test logins on this device"; prod 404 until unlocked | QL-5 (Oct 10) removed all of it. Production quick login is on/off with `QUICK_LOGIN_ENABLED` only (SYS-02, SYS-03, SYS-16, PRD-07, PRD-08, PRD-11). |

## Keeping this current

- **This doc is the master test list.** Any new or changed build prompt gets its tests added here (and to the .xlsx) in the same session.
- **Prompt 26b** (Build Prompts v2) merged this doc into QA-CHECKLIST.md, with test IDs on each step. SYS-18 checks it.
- **Every later prompt** (27, 28, the v3 fixes) ends with a line telling Replit to add its workflows to QA-CHECKLIST.md, so the file stays current.
- After any later prompt, upload the updated version of this doc to `docs/` in Replit so QA-CHECKLIST.md can be re-synced.
