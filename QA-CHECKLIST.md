# Community Care Team Volunteer Portal — UAT checklist

## CCT brand and program identity
- At 375px and 768px, check public pages show the stacked logo above the card and the mission below it; signed-in headers are white with a navy bottom rule, using the mark on phones and horizontal logo on desktop.
- Check Open Sans sentence-case titles, navy field labels, gray inputs with blue focus rings, blue primary buttons, and white/blue secondary buttons with blue/white hover.
- Check gray panels and inputs never use blue text; keyboard focus and existing navigation remain usable.
- Check volunteer-facing role wording is Resource Coordinator; admin roster and code terminology remain volunteer.
- Check contact guidance links to Cindi using shared configuration, and emails show the horizontal logo, navy rule, blue CTA, mission footer, and matching plain-text links.
- Fetch all seven `/brand/*.png` files: expect PNG content, one-year public cache headers, and no session cookie.
- Check `/style-guide` includes the new scale, colors, controls, logos and email preview in development, and remains unavailable in production.

Use one tracker row per ID below. Record tester, date, browser/device, result, and evidence.
Unless a test explicitly says production, use the development preview and synthetic accounts.
Use America/Los_Angeles for every expected date/time. Questionnaire wording is provisional, not approved final copy.

## Test preparation and automation

- Never run seed or smoke against a published app or a production database.
- Seed now requires both `NODE_ENV=development` and `SEED_DATABASE_ENVIRONMENT=development`.
- Automated route/security checks: `pnpm --filter @workspace/api-server run test:security`.
- Schedule, reminder, resource, notification and other Vitest checks: `pnpm --filter @workspace/api-server run test:schedule`.
- Auth: `pnpm --filter @workspace/api-server run test:auth`.
- Email: `pnpm --filter @workspace/api-server run test:email`.
- Volunteer privacy/profile: `pnpm --filter @workspace/api-server run test:volunteer`.
- Smoke prerequisites: running development web preview, installed Playwright Chromium, development DB access.
  Install Chromium if needed: `pnpm --filter @workspace/scripts exec playwright install chromium`.
  The script prefers system Chromium on Replit; optionally supply `CHROMIUM_EXECUTABLE_PATH`.
- Smoke: `NODE_ENV=development SMOKE_DATABASE_ENVIRONMENT=development QA_SMOKE_ALLOW_SCHEMA=1 pnpm --filter @workspace/scripts run smoke`.
  Optionally set `SMOKE_BASE_URL` to a development preview origin.
  It clones database structure into a randomly named temporary schema, starts a separate API, disables delivery/jobs,
  asserts schema isolation before starting, and drops only its own schema afterwards. Existing users/data are never copied.
  The browser exercises signup, the actual logged verification link, onboarding, admin sign-in, shift booking, message composition/read;
  staff tracking/approval and reminder clock simulation use authenticated browser API requests.
  If interrupted forcibly, remove only the specific `qa_smoke_*` schema created by that run after confirming the child API is stopped.

## Public access and authentication

| ID | Steps | Expected result |
|---|---|---|
| AUTH-01 | Open `/signup`; submit valid names, email, phone and matching password ≥8 characters. | Applicant created; verification email logged in dev; `/verify-email` shows their email. |
| AUTH-02 | Try invalid email/phone, short password, mismatched passwords and duplicate email. | Friendly validation; no privileged account or duplicate profile. |
| AUTH-03 | Before verifying, open `/dashboard`, `/profile`, `/shifts`, `/messages`, `/resources` and protected APIs. | Verification gate; APIs reject access. No protected data appears. |
| AUTH-04 | Resend verification twice within a minute; exceed five/hour using a test account. | Clear cooldown; server rate limit cannot be bypassed by refreshing. |
| AUTH-05 | Follow verification link; reuse it; try expired/altered token. | First use verifies and signs in to onboarding; other attempts rejected. |
| AUTH-06 | Use “Wrong email? Start over”; register with corrected email. | Fresh signup state; no stale verification address. |
| AUTH-07 | Sign in as admin, completed volunteer, incomplete volunteer and unverified user. | `/admin`, `/dashboard`, `/onboarding`, `/verify-email` respectively. |
| AUTH-08 | Try bad email/password and repeated guesses by IP/email. | Generic credential error; limits enforced. |
| AUTH-09 | Deactivate a test user; try existing session and new login. | Sessions end; “Your account isn't active. Please contact The Alliance.” |
| AUTH-10 | Request reset for existing/nonexistent email; compare UI response. | Same confirmation; only existing account gets email. |
| AUTH-11 | Follow valid reset link; set password; test old/new password, old sessions, reused/expired token. | New password works; old password/sessions/token fail. |
| AUTH-12 | Sign out; refresh/back/open protected link. | No cached protected view; sign-in required. |
| AUTH-13 | Attempt Google sign-in if configured. | Only enable acceptance testing after deferred Google setup is completed; no silent password-auth regression. |

## Roles and staff administration

| ID | Steps | Expected result |
|---|---|---|
| ROLE-01 | As volunteer, open `/admin/*` and call admin APIs including exports. | UI returns to dashboard; server denies all staff data/actions. |
| ROLE-02 | In two test volunteer sessions, substitute the other user's/profile's/assignment's/message's IDs. | No cross-account read/write; no other volunteer name, email, phone or staff notes in responses. |
| ROLE-03 | Check `/api/me` as volunteer/admin/unverified/anonymous. | Protected identity endpoint; volunteer profile excludes `adminNotes` and password/token fields. |
| TEAM-01 | `/admin/team`: invite admin; follow invite; set password. | Pending invite emailed; acceptance verifies email; admin can sign in. |
| TEAM-02 | Reuse, expire or alter an invite link. | Rejected without account takeover. |
| TEAM-03 | Deactivate/reactivate test admin and volunteer; confirm/cancel dialog. | Cancel changes nothing; confirmed deactivation ends sessions; reactivation restores eligibility appropriately. |
| TEAM-04 | Try self-deactivation and deactivating last active admin. | Both blocked. |
| TEAM-05 | In a safe setup environment, run `npm run create-admin -- email@domain.org "First" "Last"`. | Creates pending admin and invite link, not an immediately usable default password. Treat the link as confidential. |

## Onboarding and volunteer profile

| ID | Steps | Expected result |
|---|---|---|
| ONB-01 | Complete both questionnaire steps, required/optional fields and available choice types. | Config labels/options used; required validation correct; final answers persist. |
| ONB-02 | Save progress; reload; sign out/in; navigate back. | Draft resumes without losing answers. |
| ONB-03 | Read User Agreement/Safety Guidelines; submit with/without acknowledgment. | Completion requires current, available agreements; stores date/version. |
| ONB-04 | Remove availability of an agreement in test data. | Draft remains savable; completion clearly blocked, not silently accepted. |
| PROF-01 | `/profile`: edit name, phone, county, availability and onboarding answers. | Own records update; unknown/privileged fields cannot be changed. |
| PROF-02 | Inspect email/status/training/background/agreement fields. | Read-only, correct Pacific date display; no staff notes. |
| PROF-03 | Change password with wrong/current password; check validation and other sessions. | Wrong password blocked; success invalidates old sessions and returns to sign-in with confirmation. |

## Volunteer dashboard and shifts

| ID | Steps | Expected result |
|---|---|---|
| HOME-01 | `/dashboard` as applicant, in training, active with no shifts, active with shifts, inactive. | Correct warm status card/checklist/action; applicant isn't offered signup prematurely. |
| HOME-02 | Inspect greeting, next shift, next four occurrences, countdown and unread preview. | Own data only; Pacific dates; skips/closed dates excluded. |
| HOME-03 | Active/inactive volunteers inspect quick links and open links. | Only eligible dashboard quick links; actual new tab; HTTPS destinations. |
| SHIFT-01 | `/shifts`: book available standing slot with default and chosen start within four weeks. | Own shift/count-only grid; correct repeat/start date and confirmation email. |
| SHIFT-02 | Two volunteers simultaneously try final capacity spot. | Exactly one booking succeeds; no oversubscription. |
| SHIFT-03 | Try third shift, overlapping slots, full/inactive slot, invalid date and non-active status. | Server enforces caps, overlap, capacity, dates and eligibility. |
| SHIFT-04 | Change standing shift to available new slot; try a failing change. | Old shift released immediately on success; atomic failure leaves old shift intact; old skips aren't inherited. |
| SHIFT-05 | Drop one of two shifts; then attempt dropping only remaining shift. | Allowed drop ends assignment; last-shift drop blocked with change/contact option. |
| SHIFT-06 | Take week off >24h away; undo; try inside 24h/past/non-occurrence date. | Correct skip/undo; near-term action points to admin contact; invalid dates blocked. |
| SHIFT-07 | Navigate Home/My Shifts/Messages/Resources/Profile on phone. | Working tabs, unread badge, no lost auth state. |

## Staff roster and volunteer detail

| ID | Steps | Expected result |
|---|---|---|
| ROSTER-01 | `/admin/volunteers`: inspect desktop table/mobile cards; search name/email/phone. | All requested columns/badges; correct search results; active zero-shift flag amber. |
| ROSTER-02 | Apply each status/county/certification/background/attention filter; combine/clear. | Summary counts and matching roster; attention handles expiry ≤30d, pending >14d, incomplete onboarding, no shift. |
| ROSTER-03 | Click volunteer; select multiple rows; launch Message selected. | Correct detail/selected recipient IDs; no unintended audience expansion. |
| CSV-01 | Export roster with custom answers and multiple standing shifts; include formula-like test answer. | Date-named admin-only CSV; every profile field, config question columns, formatted shifts; spreadsheet formulas escaped. |
| CSV-02 | Export schedule with active/ended assignments and skips. | One row per active assignment; correct day/time/start/end/upcoming skips; ended records excluded. |
| DETAIL-01 | Inspect contact links, joined/login dates, answers, agreement, shifts and sent-message read states. | Correct selected volunteer; phone/email links usable on phone. |
| DETAIL-02 | Move statuses in both directions; cancel/confirm. | Change only on confirmation; actor/time/details in Activity. |
| DETAIL-03 | Remove each activation prerequisite, especially background clearance; try activating. | Exactly missing prerequisites shown; button/server block; no override of clearance. |
| DETAIL-04 | Fill certification/background dates/status; test invalid/expiry-before-completion dates. | Valid values persist; invalid values rejected; expiry warning accurate; no background reports uploaded. |
| DETAIL-05 | Inactivate volunteer with multiple shifts. | Confirmation lists releases; all assignments ended `admin_removed` today; reductions trigger eligible alerts. |
| DETAIL-06 | Autosave staff notes, reload, inspect volunteer APIs. | Persist for staff only; never returned to volunteers. |

## Schedule configuration, coordination and overrides

| ID | Steps | Expected result |
|---|---|---|
| GRID-01 | `/admin/schedule/settings`: add/edit weekday/time/capacity/label/active. | Default end +2h; valid 1–10 capacity; overlap note, not error. |
| GRID-02 | Reduce capacity below assignments; deactivate occupied slot with end-now/date options. | Unsafe reduction blocked; explicit retirement choice honored; correct emails/coverage consequences. |
| GRID-03 | Copy Monday to all weekdays. | Fast setup without accidental duplicate/overlapping-coverage corruption. |
| CLOSED-01 | Add/reason/delete closed date; inspect schedule/reminders/gaps. | Closed label; occurrences/reminders/alerts suppressed only that day; deletion restores availability. |
| COORD-01 | `/admin`: on-shift volunteer contacts/end time; overlapping slots; operating-hours empty/outside-hours. | Correct now/next state and no duplicate person; amber empty operating hours; distinct outside-hours state. |
| COORD-02 | Wait one refresh cycle; simulate fetch failure. | Updated time refreshes each minute; stale schedule never presented as current dispatch information. |
| COORD-03 | In dev, use `?at=` with explicit-zone timestamp for now/next; try in production. | Dev simulation works; production refuses overrides. |
| WEEK-01 | `/admin/schedule`: prev/next/today; fully covered/under/empty/closed/week-off/overlap blocks. | Correct colors/counts; side-by-side overlaps; struck-through skips; today highlight. |
| WEEK-02 | At 375px/768px use day picker and block side panel. | Usable day list; correct selected volunteer links/capacity. |
| OVR-01 | Assign active volunteer; exceed cap/capacity without/with override and reason. | Normal rules unless explicit permitted override + reason; activity records exception. Overlap/eligibility rules remain enforced. |
| OVR-02 | Remove assignment with/without email; add/remove week off from both entry points. | Correct release/skip, optional email, activity entry and coverage impact. |
| ALERT-01 | Drop/remove/inactivate or near-term week off that reduces coverage; repeat event. | Combined alert only for actual reduction, correct impacted dates/count/reason/week link; closed dates suppressed. |
| DIGEST-01 | Toggle digest; simulate weekday 07:00 Pacific and rerun; test no gaps/weekend. | Eligible next-seven-day gaps only; no duplicate by Pacific date; disabled/empty/weekend sends none. |

## Messaging and reminders

| ID | Steps | Expected result |
|---|---|---|
| MSG-01 | `/admin/messages`: active/all/selected/single audience; valid subject/body; preview/edit/send. | Correct count; editing invalidates preview; explicit send confirmation; no accidental broad send. |
| MSG-02 | Preview bold/links/lists and HTML/script-like input; toggle email off/on. | Safe markdown rendering; inbox always created; email only when enabled, branded with portal link. |
| MSG-03 | Repeat same send/retry and exceed send rate using synthetic recipient. | Idempotent recipients; no duplicate email; staff/IP send limits enforced. |
| MSG-04 | `/messages`: open unread message, return to list, refresh; inspect nav/read receipts/detail. | Marks own receipt once; badge/read counts correct; no in-app reply; admin contact copy present. |
| MSG-05 | Try another recipient's message ID. | Not found/denied; body and identity never exposed. |
| REM-01 | `/admin/notifications/jobs`: run check with dev clock 24h before owned occurrence; rerun. | Exactly one logged reminder per assignment/date/variant; dashboard counters/last run updated. |
| REM-02 | Test week off, closure, inactive volunteer, assignment bounds, overlapping slots and optional morning reminder. | Only eligible recipients; morning separately deduped; correct Pacific time/quick links/week-off copy. |
| REM-03 | POST `/api/jobs/run` with missing/wrong/correct secret header. | Missing/wrong denied; valid secret invokes job; browser auth isn't a substitute for job secret. Never paste secrets in tracker. |
| REM-04 | Start with `RUN_JOBS=false`, then authorized dev true; inspect production scheduler choice. | No cron without flag; only one scheduler strategy enabled; 15-minute/Pacific timing. |

## Notification monitoring, email delivery and resources

| ID | Steps | Expected result |
|---|---|---|
| EMAIL-01 | In dev without provider config, send owned test email and inspect server/log. | Full test links visible in console; `logged` row; branded HTML + matching text. |
| EMAIL-02 | In isolated production-mode test without complete provider config. | `failed` row and safe error; no body/recovery/invite link logged; no exception escapes caller. |
| EMAIL-03 | In approved email test environment, test provider success/failure and duplicate related ID. | `sent` + provider ID or `failed` + safe error; same recipient/type/related ID not resent; outbound stream. |
| NOTIF-01 | `/admin/notifications`: current Pacific month, type totals, six-month chart and limit progress. | Sent+logged only; accurate month boundaries; amber ≥80%, red ≥95%. |
| NOTIF-02 | Configure small isolated limit and cross 80%; repeat/retry. | Active admins alerted once per month threshold; no historical usage inflation. |
| NOTIF-03 | Filter type/status/date/recipient; inspect failed row; retry. | Correct metadata-only results; retry in place/idempotent; recovery links regenerated, not stale; uncertain delivery handled safely. |
| NOTIF-04 | Inspect provider status and sender; development test button. | No token exposed; recipient is current admin; test email APIs/buttons disabled in production. |
| RES-01 | `/admin/resources`: each tab create/edit/reorder/publish/unpublish/delete cancel/confirm. | Sort order persists; deleted/unpublished items disappear from volunteer hub. |
| RES-02 | Upload valid PDF/DOCX ≤15MB; replace file on existing record. | Private storage/authenticated download; same record; no public object URL or orphaned old file. |
| RES-03 | Try >15MB, fake extension/signature, malformed/traversal/macro DOCX and unsafe filename. | Rejected/safely named; no publicly executable content or invalid resource record. |
| RES-04 | `/resources`: quick links/search/category/card/article; open document in new tab. | Published only; correct file icons; clean markdown; native new-tab links. |
| RES-05 | Create HTTP/javascript/credential-bearing link URL. | Rejected; HTTPS-only links accepted. |
| RES-06 | Update agreement, choose version bump; sign in as previously acknowledged volunteer. | Must re-acknowledge current agreement before shift actions; date/version update; no draft policy silently published. |
| RES-07 | Anonymous/unverified users request private document; volunteer requests draft/deleted document. | Denied/not found; no storage key/content leak. |

## Cross-cutting security, Pacific dates and accessibility

| ID | Steps | Expected result |
|---|---|---|
| SEC-01 | Run actual route inventory test; add a temporary endpoint without declaration in a disposable branch. | Test fails; undeclared API fails closed; HEAD follows GET guard; job/public exceptions explicit. |
| SEC-02 | Submit arrays/null/unknown privileged fields, invalid IDs/dates and malformed JSON to writes. | Zod/domain validation; consistent `{error, code}`; no mass assignment; no stack traces. |
| SEC-03 | Send mutations with missing/foreign Origin and missing/incorrect CSRF token; then correct pair. | Invalid pairs rejected; valid pair works; secret-authenticated job route is intentional exception. |
| SEC-04 | Inspect API headers and production session cookie. | Helmet headers, no exposed framework header; httpOnly/secure/SameSite=lax; private APIs no-store. |
| SEC-05 | Production: request style guide, test-email endpoints, clock override; attempt seed without exact dev confirmations. | No dev-only capability; seed refuses before DB access or file writes. |
| TIME-01 | Test weeks 2026-03-02/09 and 2026-10-26/11-02 with skips/closed/overlapping slots. | Standing hours remain Pacific; UTC offset changes; no phantom/missing weekday occurrences. |
| TIME-02 | Use browser zones UTC/New York; inspect login/activity/job/notification/agreement/shift dates near UTC midnight. | Business timestamps display Pacific; date-only calendar values do not move a day. |
| UI-01 | Every public, volunteer and staff page at 375px and 768px; desktop roster/schedule too. | No horizontal scroll; tables/cards/dialogs readable; one-handed coordinator/volunteer home. |
| UI-02 | Navigate all forms/tabs/dialogs/schedule using keyboard; Escape, focus return, submit errors. | Visible focus; correct labels, focus trap/return; meaningful announced errors/toasts; no keyboard trap. |
| UI-03 | Check contrast, zoom 200%, ≥44px targets, long names/text and empty/loading/error states. | WCAG AA-oriented styling remains usable; warm, specific copy without stigmatizing family language. |
| UI-04 | Inspect manifest/icons; add to home screen; sign out and relaunch. | Branded app/icon/theme; no cached private data or bypassed sign-in. |
