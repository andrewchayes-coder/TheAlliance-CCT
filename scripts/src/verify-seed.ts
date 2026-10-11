import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  insertUserSchema, insertVolunteerProfileSchema, insertShiftSlotSchema, insertShiftAssignmentSchema, insertResourceSchema,
  insertNotificationLogSchema, toVolunteerProfilePublic, volunteerProfilePublicColumns,
} from '@workspace/shared/schema';
import { adminId, buildSeedFixtures } from './seed-fixtures';
import { addDays, verifySeedPassword, weekday } from './seed-support';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Verification probes are development-only.');
  const { db, pool, usersTable, volunteerProfilesTable, eq, inArray } = await import('@workspace/db');
  const fixtures = buildSeedFixtures({ admin: 'unused', volunteers: Array<string>(18).fill('unused') });
  const expected = [
    ['users', fixtures.users], ['volunteer_profiles', fixtures.profiles], ['shift_slots', fixtures.slots],
    ['shift_assignments', fixtures.assignments], ['shift_skips', fixtures.skips],
    ['closed_dates', fixtures.closedDates], ['messages', fixtures.messages],
    ['message_recipients', fixtures.recipients], ['resources', fixtures.resources],
  ] as const;
  try {
    for (const [table, rows] of expected) {
      // Identifier is from this fixed literal allowlist; IDs are always bound parameters.
      const result = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "${table}" WHERE id = ANY($1::uuid[])`, [rows.map(row => row.id)],
      );
      assert.equal(Number(result.rows[0]!.count), rows.length, `Seed count for ${table}`);
    }
    const tables = [...expected.map(([name]) => name), 'notification_log', 'auth_tokens'];
    const columns = await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)
       AND column_name IN ('id', 'created_at', 'updated_at')`, [tables],
    );
    assert.equal(columns.rowCount, 33, 'All 11 tables have ID and both timestamps');
    for (const column of columns.rows) {
      assert.equal(column.data_type, column.column_name === 'id' ? 'uuid' : 'timestamp with time zone');
      assert.equal(column.is_nullable, 'NO');
    }

    const [admin] = await db.select().from(usersTable).where(eq(usersTable.id, adminId));
    assert.ok(admin && admin.role === 'admin' && admin.emailVerifiedAt && admin.isActive);
    assert.ok(verifySeedPassword('ChangeMe123!', admin.passwordHash));
    assert.equal(verifySeedPassword('WrongPassword', admin.passwordHash), false);
    const profiles = await db.select().from(volunteerProfilesTable)
      .where(inArray(volunteerProfilesTable.id, fixtures.profiles.map(profile => profile.id!)));
    assert.deepEqual({
      onboarding: profiles.filter(profile => profile.status === 'onboarding').length,
      active: profiles.filter(profile => profile.status === 'active').length,
      inactive: profiles.filter(profile => profile.status === 'inactive').length,
    }, { onboarding: 7, active: 10, inactive: 1 });
    assert.equal(Object.hasOwn(toVolunteerProfilePublic(profiles[0]!), 'adminNotes'), false);
    assert.equal(Object.hasOwn(volunteerProfilePublicColumns, 'adminNotes'), false);
    const emails = await pool.query<{ email: string }>('SELECT email FROM users WHERE id = ANY($1::uuid[])', [fixtures.users.map(user => user.id)]);
    assert.ok(emails.rows.every(user => user.email.endsWith('@example.org') && user.email === user.email.toLowerCase()));
    const inactive = profiles.find(profile => profile.status === 'inactive')!;
    const [inactiveUser] = await db.select().from(usersTable).where(eq(usersTable.id, inactive.userId));
    assert.equal(inactiveUser!.isActive, false);

    const assignments = await pool.query<{ volunteer_profile_id: string; shift_slot_id: string; end_date: string | null }>(
      'SELECT volunteer_profile_id, shift_slot_id, end_date FROM shift_assignments WHERE id = ANY($1::uuid[])',
      [fixtures.assignments.map(assignment => assignment.id)],
    );
    for (const profile of profiles.filter(value => value.status === 'active')) {
      const standing = assignments.rows.filter(assignment => assignment.volunteer_profile_id === profile.id);
      assert.ok(standing.length >= 1 && standing.length <= 2);
      assert.ok(standing.every(assignment => assignment.end_date === null));
    }
    const occupiedSlots = new Set(assignments.rows.map(assignment => assignment.shift_slot_id));
    assert.ok(occupiedSlots.size < 20, 'There are intentional unassigned slots');
    for (const slot of fixtures.slots) {
      assert.ok(assignments.rows.filter(assignment => assignment.shift_slot_id === slot.id).length <= slot.capacity!);
    }
    const skipRows = await pool.query<{ skip_date: string; day_of_week: number }>(
      `SELECT sk.skip_date::text, sl.day_of_week FROM shift_skips sk
       JOIN shift_assignments a ON a.id = sk.shift_assignment_id
       JOIN shift_slots sl ON sl.id = a.shift_slot_id WHERE sk.id = ANY($1::uuid[])`,
      [fixtures.skips.map(skip => skip.id)],
    );
    assert.ok(skipRows.rows.every(skip => weekday(skip.skip_date) === skip.day_of_week));
    const resourceCounts = await pool.query<{ type: string; count: string }>(
      'SELECT type, count(*) FROM resources WHERE id = ANY($1::uuid[]) GROUP BY type', [fixtures.resources.map(resource => resource.id)],
    );
    assert.deepEqual(Object.fromEntries(resourceCounts.rows.map(row => [row.type, Number(row.count)])), { article: 3, document: 3, link: 3 });
    const quickLinks = await pool.query<{ title: string }>('SELECT title FROM resources WHERE is_quick_link AND id = ANY($1::uuid[]) ORDER BY title', [fixtures.resources.map(resource => resource.id)]);
    assert.deepEqual(quickLinks.rows.map(row => row.title), ['Log in to Find Help', 'Open Phone Portal']);
    for (const document of fixtures.resources.filter(resource => resource.type === 'document')) {
      const bytes = await readFile(resolve(import.meta.dirname, '../..', 'artifacts/alliance-volunteer-portal/public', document.fileKey!));
      assert.equal(bytes.subarray(0, 8).toString(), '%PDF-1.4');
    }

    const normalized = insertUserSchema.parse({
      email: ' ADMIN@EXAMPLE.ORG ', passwordHash: admin.passwordHash, firstName: 'Test', lastName: 'User',
    });
    assert.equal(normalized.email, 'admin@example.org');
    assert.equal(insertVolunteerProfileSchema.safeParse({
      userId: adminId, certificationCompletedAt: null, certificationExpiresAt: null,
      backgroundCheckSubmittedAt: null, backgroundCheckClearedAt: null,
    }).success, true);
    assert.equal(insertShiftSlotSchema.safeParse({ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }).success, true);
    assert.equal(insertShiftSlotSchema.safeParse({ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }).success, false);
    assert.equal(insertShiftSlotSchema.safeParse({ dayOfWeek: 1, startTime: '9:00', endTime: '11:00' }).success, false);
    assert.equal(insertShiftAssignmentSchema.safeParse({ ...fixtures.assignments[0], startDate: '2026-02-30' }).success, false);
    assert.equal(insertResourceSchema.safeParse({ type: 'document', title: 'Missing file', category: 'Test', createdByUserId: adminId }).success, false);
    assert.equal(insertNotificationLogSchema.safeParse({ type: 'reminder', recipientEmail: 'admin@example.org', subject: 'Test' }).success, true);

    // All write probes run inside savepoints and a final rollback. No test rows persist.
    const client = await pool.connect();
    type Statement = { text: string; values: unknown[] };
    let probes = 0;
    try {
      await client.query('BEGIN');
      const probe = async (name: string, statements: Statement[], expectedCode: string | null) => {
        await client.query('SAVEPOINT constraint_probe');
        let code: string | null = null;
        try {
          for (const statement of statements) await client.query(statement.text, statement.values);
        } catch (error) {
          code = (error as { code?: string }).code ?? 'unknown';
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT constraint_probe');
          await client.query('RELEASE SAVEPOINT constraint_probe');
        }
        assert.equal(code, expectedCode, name);
        probes++;
      };
      const userInsert = (email: string) => ({
        text: "INSERT INTO users(email,password_hash,first_name,last_name) VALUES($1,'dummy-hash','Test','Fixture')",
        values: [email],
      });
      await probe('Uppercase emails are rejected', [userInsert('Uppercase@example.org')], '23514');
      await probe('Emails are unique', [userInsert('admin@example.org')], '23505');
      await probe('Profile user FK exists', [{
        text: 'INSERT INTO volunteer_profiles(user_id) VALUES($1)', values: [randomUUID()],
      }], '23503');
      for (const [day, start, end, capacity] of [[6, '09:00', '11:00', 2], [1, '9:00', '11:00', 2], [1, '13:00', '11:00', 2], [1, '09:00', '11:00', 0]]) {
        await probe('Invalid slot is rejected', [{
          text: 'INSERT INTO shift_slots(day_of_week,start_time,end_time,capacity) VALUES($1,$2,$3,$4)', values: [day, start, end, capacity],
        }], '23514');
      }
      await probe('Overlapping slots are allowed', [{
        text: "INSERT INTO shift_slots(day_of_week,start_time,end_time) VALUES(1,'10:00','12:00')", values: [],
      }], null);
      const assignment = fixtures.assignments[0]!;
      await probe('Assignment date ordering is enforced', [{
        text: 'INSERT INTO shift_assignments(volunteer_profile_id,shift_slot_id,start_date,end_date,created_by_user_id) VALUES($1,$2,$3,$4,$5)',
        values: [assignment.volunteerProfileId, assignment.shiftSlotId, assignment.startDate, addDays(assignment.startDate, -1), adminId],
      }], '23514');
      const skip = fixtures.skips[0]!;
      await probe('Skip dates are unique per assignment', [{
        text: 'INSERT INTO shift_skips(shift_assignment_id,skip_date) SELECT shift_assignment_id,skip_date FROM shift_skips WHERE id=$1', values: [skip.id],
      }], '23505');
      await probe('Closed dates are unique', [{
        text: "INSERT INTO closed_dates(date,reason) SELECT date,'Duplicate probe' FROM closed_dates WHERE id=$1", values: [fixtures.closedDates[0]!.id],
      }], '23505');
      const reminder = {
        text: "INSERT INTO notification_log(type,recipient_email,recipient_user_id,subject,related_id) VALUES('reminder','admin@example.org',$1,'Probe',$2)",
        values: [adminId, `constraint-probe:${randomUUID()}`],
      };
      await probe('Duplicate reminders are rejected', [reminder, reminder], '23505');
      await probe('Unkeyed reminders are allowed', [{
        text: "INSERT INTO notification_log(type,recipient_email,subject) VALUES('reminder','admin@example.org','Probe')", values: [],
      }], null);
      const emailOnlyReminder = {
        text: "INSERT INTO notification_log(type,recipient_email,subject,related_id) VALUES('reminder','admin@example.org','Probe',$1)",
        values: [`constraint-probe:${randomUUID()}`],
      };
      await probe('Omitting a recipient user does not bypass keyed reminder uniqueness', [emailOnlyReminder, emailOnlyReminder], '23505');
      const ordinaryMessage = { ...reminder, text: reminder.text.replace("'reminder'", "'welcome'") };
      await probe('Non-reminder logs may share a related key', [ordinaryMessage, ordinaryMessage], null);
      await probe('Message recipients are unique', [{
        text: 'INSERT INTO message_recipients(message_id,recipient_user_id) SELECT message_id,recipient_user_id FROM message_recipients WHERE id=$1',
        values: [fixtures.recipients[0]!.id],
      }], '23505');
      const token = {
        text: "INSERT INTO auth_tokens(user_id,type,token_hash,expires_at) VALUES($1,'email_verify',$2,now()+interval '1 hour')",
        values: [adminId, `hashed-probe-${randomUUID()}`],
      };
      await probe('Token hashes are unique', [token, token], '23505');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    console.log(`Seed verified: 11 tables, all fixture counts, safe volunteer projection, admin password hash, PDFs, Zod validation, and ${probes} rollback-only database constraint probes.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Seed verification failed.');
  process.exitCode = 1;
});
