# Remove development seed data from production

## Safety and scope

**The agent has not run any production queries or changes.** Run the SQL below yourself in the **Production** Database tool.
This permanently deletes non-test `@example.org` accounts and their related records, including anything later created by those accounts.
Review the resource list carefully: later uploads by `admin@example.org` are included, not just the original placeholders.

1. Pause cron-job.org first. `RUN_JOBS=false` alone does not disable the external job endpoint.
2. Have a current production backup/recovery point available. These statements are independent, **not one transaction**.
3. Run every pre-check. Stop if any required result differs. Confirm you can sign in with your preserved non-example.org admin.
4. Copy **only the SQL and its comments**, not Markdown fences. Execute each numbered DELETE in order.
5. On any error, stop; do not skip ahead to deleting users. Already successful statements can safely be re-run.
6. Run the post-checks, sign in with the preserved admin, and review the roster and schedule before resuming cron.

The QA prefix is an extra protection even if a QA flag was accidentally cleared. `shift_slots`, `app_settings`,
`reminder_job_runs`, and `auth_rate_limits` are never deleted or updated. No production storage files are touched.
No temporary tables, transactions, functions, CTEs, or schema changes are required.

## 1. Pre-checks

### A. Preserved active admin — both counts must be at least 1

If either count is 0, **STOP and create/verify your real admin first**.

```sql
SELECT count(*) AS active_non_example_admins, count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified_active_non_example_admins FROM users WHERE role='admin' AND is_active=true AND email NOT LIKE '%@example.org';
```

### B. Users to remove — expected 19 (18 volunteers and admin@example.org)

If not 19, review the difference before deleting. On a completed re-run this is 0.

```sql
SELECT count(*) AS seed_users_to_delete FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org';
```

### C. Preserved QA users — expected 5

```sql
SELECT count(*) AS qa_test_users FROM users WHERE email LIKE 'qa-%@example.org' AND is_test_account=true;
```

### D. Protected-owner dependencies — every result must be 0

The scope says both “delete records created by seed users” and “keep everything belonging to QA/non-seed users.”
Those conflict if a seed admin created shifts/messages/activity for preserved people. **If any count is nonzero, STOP**:
ownership must be reviewed/reassigned separately, not deleted automatically.
The DELETEs also preserve these cross-linked records; if checks are ignored, foreign keys stop parent deletion rather than cascading away preserved recipients.

```sql
SELECT count(*) AS protected_standing_assignments FROM shift_assignments a JOIN volunteer_profiles p ON p.id=a.volunteer_profile_id JOIN users u ON u.id=p.user_id WHERE (u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org') AND a.created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS protected_custom_assignments FROM custom_shift_assignments a JOIN volunteer_profiles p ON p.id=a.volunteer_profile_id JOIN users u ON u.id=p.user_id WHERE (u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org') AND (a.created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') OR a.custom_shift_id IN (SELECT id FROM custom_shifts WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')));
SELECT count(*) AS protected_message_recipients FROM message_recipients r JOIN users u ON u.id=r.recipient_user_id WHERE (u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org') AND r.message_id IN (SELECT id FROM messages WHERE sender_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org'));
SELECT count(*) AS protected_activity_records FROM activity_log a JOIN volunteer_profiles p ON p.id=a.volunteer_profile_id JOIN users u ON u.id=p.user_id WHERE (u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org') AND a.actor_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
```

### E. Record the slot baseline and review resources

Save the slot count: the post-check must equal it. Do not expect a hard-coded production count.
The current development seed has 40 slots; older production grids can differ. All are preserved.
The resource list should contain only material you intend to remove (normally 9 development resources).

```sql
SELECT count(*) AS shift_slots_before FROM shift_slots;
SELECT id, title, type, is_published FROM resources WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') ORDER BY title;
```

## 2. DELETE statements — children before parents

```sql
-- 1. Remove week-offs for standing assignments being removed, excluding preserved owners.
DELETE FROM shift_skips WHERE shift_assignment_id IN (SELECT a.id FROM shift_assignments a JOIN volunteer_profiles p ON p.id=a.volunteer_profile_id JOIN users u ON u.id=p.user_id WHERE u.email LIKE '%@example.org' AND u.is_test_account=false AND u.email NOT LIKE 'qa-%@example.org');
-- 2. Remove custom assignments for seed volunteers, or seed-created assignments/shifts, excluding preserved owners.
DELETE FROM custom_shift_assignments WHERE (volunteer_profile_id IN (SELECT id FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) OR created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') OR custom_shift_id IN (SELECT id FROM custom_shifts WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org'))) AND volunteer_profile_id NOT IN (SELECT p.id FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org');
-- 3. Remove standing assignments owned by seed profiles or created by seed users, excluding preserved owners.
DELETE FROM shift_assignments WHERE (volunteer_profile_id IN (SELECT id FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) OR created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) AND volunteer_profile_id NOT IN (SELECT p.id FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org');
-- 4. Remove date-specific slot blocks created by seed users, keeping the slots.
DELETE FROM slot_blocks WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 5. Remove seed-created custom shifts only when no preserved assignments remain.
DELETE FROM custom_shifts WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') AND NOT EXISTS (SELECT 1 FROM custom_shift_assignments a WHERE a.custom_shift_id=custom_shifts.id);
-- 6. Remove message receipts whose recipient is a seed user.
DELETE FROM message_recipients WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 7. Remove seed-sent messages only when no preserved receipts remain (remaining receipts otherwise cascade).
DELETE FROM messages WHERE sender_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') AND NOT EXISTS (SELECT 1 FROM message_recipients r WHERE r.message_id=messages.id);
-- 8. Remove resources and quick links created by seed users.
DELETE FROM resources WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 9. Remove notification rows linked to seed user IDs, regardless of their recorded delivery address.
DELETE FROM notification_log WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 10. Remove other example.org notifications, including email-test@example.org, but preserve QA address/owner rows.
DELETE FROM notification_log WHERE recipient_email LIKE '%@example.org' AND recipient_email NOT LIKE 'qa-%@example.org' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=notification_log.recipient_user_id AND (u.is_test_account=true OR u.email LIKE 'qa-%@example.org'));
-- 11. Remove activity for seed profiles or by seed actors, excluding preserved profiles.
DELETE FROM activity_log WHERE (volunteer_profile_id IN (SELECT id FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) OR actor_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) AND volunteer_profile_id NOT IN (SELECT p.id FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE u.is_test_account=true OR u.email NOT LIKE '%@example.org' OR u.email LIKE 'qa-%@example.org');
-- 12. Remove unused and historical authentication tokens for seed users.
DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 13. Remove sessions using the actual stored JSON userId field.
DELETE FROM sessions WHERE sess->>'userId' IN (SELECT id::text FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 14. Remove the seed volunteers' profiles.
DELETE FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
-- 15. Finally remove non-test example.org users, including admin@example.org, but never qa-* users.
DELETE FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org';
-- 16. OPTIONAL: remove only the exact seeded October 12 closure; OMIT if The Alliance is actually closed that day.
DELETE FROM closed_dates WHERE id='84746337-cff5-58a3-95bc-4fe40db223ef' AND date='2026-10-12' AND reason='Indigenous Peoples'' Day / Columbus Day';
```

## 3. Post-checks

All seed counts below must be **0**, QA must still be **5**, slots must match the saved baseline, and the preserved admin must remain available.
The joins use live identities; enforced foreign keys prevent child rows surviving after their parent is deleted.
The additional orphan checks independently verify that protection rather than relying only on now-empty identity subqueries.

```sql
SELECT count(*) AS remaining_non_test_example_users FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org';
SELECT count(*) AS remaining_seed_profiles FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS remaining_seed_standing_assignments FROM shift_assignments WHERE volunteer_profile_id IN (SELECT id FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) OR created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS remaining_seed_custom_assignments FROM custom_shift_assignments WHERE volunteer_profile_id IN (SELECT id FROM volunteer_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org')) OR created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS remaining_seed_messages FROM messages WHERE sender_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS remaining_seed_resources FROM resources WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org');
SELECT count(*) AS remaining_seed_notification_rows FROM notification_log WHERE recipient_user_id IN (SELECT id FROM users WHERE email LIKE '%@example.org' AND is_test_account=false AND email NOT LIKE 'qa-%@example.org') OR (recipient_email LIKE '%@example.org' AND recipient_email NOT LIKE 'qa-%@example.org' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=notification_log.recipient_user_id AND (u.is_test_account=true OR u.email LIKE 'qa-%@example.org')));
SELECT count(*) AS orphan_profiles FROM volunteer_profiles p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=p.user_id);
SELECT count(*) AS orphan_standing_assignments FROM shift_assignments a WHERE NOT EXISTS (SELECT 1 FROM volunteer_profiles p WHERE p.id=a.volunteer_profile_id) OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id=a.created_by_user_id);
SELECT count(*) AS orphan_custom_assignments FROM custom_shift_assignments a WHERE NOT EXISTS (SELECT 1 FROM volunteer_profiles p WHERE p.id=a.volunteer_profile_id) OR NOT EXISTS (SELECT 1 FROM custom_shifts s WHERE s.id=a.custom_shift_id) OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id=a.created_by_user_id);
SELECT count(*) AS orphan_messages FROM messages m WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=m.sender_user_id);
SELECT count(*) AS orphan_resources FROM resources r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=r.created_by_user_id);
SELECT count(*) AS qa_test_users FROM users WHERE email LIKE 'qa-%@example.org' AND is_test_account=true;
SELECT count(*) AS shift_slots_after FROM shift_slots;
SELECT count(*) AS verified_active_non_example_admins FROM users WHERE role='admin' AND is_active=true AND email_verified_at IS NOT NULL AND email NOT LIKE '%@example.org';
```

## Likely origin and current prevention

The most likely cause is copying the development database during first Publish: Replit offers
“Set up your production database with your current development data.” A copied snapshot retains October 7 row timestamps.
An earlier manual seed/data import could also explain it. This is a likely explanation, not a verified production history.
See [Replit's development/production database documentation](https://docs.replit.com/features/data-and-storage/development-and-production).

Current build/start commands do not run the development seed. Startup may ensure the five explicitly approved QA personas
when testing is enabled; that does not create the 19 non-test seed identities. `npm run seed` refuses to run unless both `NODE_ENV=development`
and `SEED_DATABASE_ENVIRONMENT=development`; it never overrides NODE_ENV. Those guards cannot protect against an operator
deliberately pointing a development-configured connection at production, or opting into the initial Publish data copy.
Never supply production credentials to a development command or copy development data into production.

The legacy resource download route did previously attempt to upload and rewrite an **existing** seed resource in production;
it did not create users/resources. It now permits that upgrade only in development and returns a controlled 404 elsewhere.
The standalone `migrate-resource-seeds` utility now requires both development acknowledgments as well.
These two guards are the only application changes in this SQL-focused cleanup.
They take effect in the deployed app after your next Publish; publishing alone does not delete existing seed data.

## Development verification

Passed on October 11, 2026:

- Created an isolated schema inside the development DB using the actual schema/foreign keys, ran the real seed, and ensured all five QA personas.
  Added synthetic preserved-admin and child-record fixtures; no real volunteer rows were copied into the test schema.
- Ran every exact DELETE above individually, in order, including the optional closure DELETE. Removed 19 seed users;
  all post-checks were zero, five QA users remained, the preserved admin remained, and all 40 development slots remained.
- Compared preserved QA/non-seed fixture rows and their linked records before/after. They were unchanged.
  Full-row comparisons also proved `shift_slots`, `app_settings`, `reminder_job_runs`, and `auth_rate_limits` unchanged.
- Tested custom assignments, slot blocks, skips, messages/receipts, activity, tokens, JSON sessions,
  no-user `email-test@example.org` notifications, and QA notifications with an old non-QA example.org delivery address.
- Re-ran all 16 statements: every DELETE affected zero rows.
- Deliberately added seed-created records owned by QA users: all four dependency checks detected them,
  and the guarded destructive statements left those records intact.
- Simulated production behavior against only the owned development schema: legacy document download returned a controlled 404
  without file access/upload/key rewrite; the seed-resource utility refused before selecting rows. No production connection was used.
- Browser smoke passed using the isolated API with email sending and jobs disabled:
  admin home, roster (four QA volunteer profiles when test accounts are shown), and the 40-slot master schedule.
  Reset test accounts worked through its confirmation UI and retained exactly five QA identities.
  Admin landed at `/admin`; Active, Active/No Shift, and Onboarding/Ready landed at `/dashboard`;
  Onboarding/New landed at `/onboarding`, each with the correct TEST banner.
  The explicit reset was tested **after** SQL-preservation comparisons.
- Removed the temporary API, isolated schema, and validation harnesses. Re-ran `npm run seed` in explicitly acknowledged development
  at the end: the normal development demo data is present, without resetting existing records or sending email.
- API type-check and build passed. Only the two missing development-only guards changed application code.
