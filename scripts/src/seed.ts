import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { buildSeedFixtures } from './seed-fixtures';
import { hashSeedPassword, writeSeedDocuments } from './seed-support';

async function main() {
  // Check before importing the DB client or writing any files. Never override NODE_ENV.
  if (process.env.NODE_ENV !== 'development' || process.env.SEED_DATABASE_ENVIRONMENT !== 'development') {
    throw new Error('Seed refused: explicitly set NODE_ENV=development and SEED_DATABASE_ENVIRONMENT=development. Never seed production.');
  }
  const { db, pool, usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable,
    shiftSkipsTable, closedDatesTable, messagesTable, messageRecipientsTable, resourcesTable,
    insertUserSchema, insertVolunteerProfileSchema, insertShiftSlotSchema, insertShiftAssignmentSchema,
    insertShiftSkipSchema, insertClosedDateSchema, insertMessageSchema, insertMessageRecipientSchema,
    insertResourceSchema } = await import('@workspace/db');
  try {
    const fixtures = buildSeedFixtures({
      admin: hashSeedPassword('ChangeMe123!'),
      // Dummy volunteers have individually randomized passwords; only the specified admin login is seeded.
      volunteers: Array.from({ length: 18 }, () => hashSeedPassword(randomBytes(32).toString('base64url'))),
    });
    const validators = [
      [fixtures.users, insertUserSchema], [fixtures.profiles, insertVolunteerProfileSchema],
      [fixtures.slots, insertShiftSlotSchema], [fixtures.assignments, insertShiftAssignmentSchema],
      [fixtures.skips, insertShiftSkipSchema], [fixtures.closedDates, insertClosedDateSchema],
      [fixtures.messages, insertMessageSchema], [fixtures.recipients, insertMessageRecipientSchema],
      [fixtures.resources, insertResourceSchema],
    ] as const;
    for (const [rows, schema] of validators) for (const row of rows) schema.parse(row);

    await db.transaction(async tx => {
      const existingUsers = await tx.select({ id: usersTable.id, email: usersTable.email }).from(usersTable)
        .where(inArray(usersTable.email, fixtures.users.map(user => user.email)));
      for (const existing of existingUsers) {
        if (fixtures.users.find(user => user.email === existing.email)?.id !== existing.id) {
          throw new Error('Seed refused: a dummy email belongs to a non-seed record. Existing records were not changed.');
        }
      }
      // No deletes or updates. Stable IDs and uniqueness constraints make repeated runs no-ops.
      await tx.insert(usersTable).values(fixtures.users).onConflictDoNothing();
      await tx.insert(volunteerProfilesTable).values(fixtures.profiles).onConflictDoNothing();
      await tx.insert(shiftSlotsTable).values(fixtures.slots).onConflictDoNothing();
      await tx.insert(shiftAssignmentsTable).values(fixtures.assignments).onConflictDoNothing();
      await tx.insert(shiftSkipsTable).values(fixtures.skips).onConflictDoNothing();
      await tx.insert(closedDatesTable).values(fixtures.closedDates).onConflictDoNothing();
      await tx.insert(messagesTable).values(fixtures.messages).onConflictDoNothing();
      await tx.insert(messageRecipientsTable).values(fixtures.recipients).onConflictDoNothing();
      await tx.insert(resourcesTable).values(fixtures.resources).onConflictDoNothing();
    });
    await writeSeedDocuments();
    console.log('Development seed complete (safe to rerun).');
    console.log('Fixtures: 1 verified admin, 18 volunteers, 20 slots, 18 assignments, 2 skips, 1 holiday closure, 2 messages, 19 recipients, 9 resources, 2 quick links.');
    console.log('No emails were sent. No existing rows were deleted or reset.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Development seed failed.');
  process.exitCode = 1;
});
