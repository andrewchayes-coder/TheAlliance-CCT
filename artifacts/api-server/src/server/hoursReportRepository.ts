import { and, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, usersTable as users, volunteerProfilesTable as profiles, volunteerHoursTable as hours } from '@workspace/db';
import { buildHoursReport, reportPeriod } from './hoursReport';
import { readScheduleData } from './scheduleRepository';

export async function readHoursReport(now: Date, month: unknown, includeTest: boolean) {
  const period = reportPeriod(month, now);
  return db.transaction(async tx => {
    const people = (await tx.select({ userId: users.id, profileId: profiles.id, firstName: users.firstName,
      lastName: users.lastName, email: users.email, role: users.role, status: profiles.status, isTestAccount: users.isTestAccount })
      .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      .where(and(eq(users.role, 'volunteer'), includeTest ? undefined : eq(users.isTestAccount, false))))
      .map(p => ({ ...p, name: `${p.firstName} ${p.lastName}`.trim() }));
    const actor = alias(users, 'hours_actor');
    const entries = (await tx.select({ entry: hours, actorFirst: actor.firstName, actorLast: actor.lastName })
      .from(hours).innerJoin(profiles, eq(profiles.id, hours.volunteerProfileId))
      .innerJoin(users, eq(users.id, profiles.userId)).innerJoin(actor, eq(actor.id, hours.enteredByUserId))
      .where(and(gte(hours.shiftDate, period.trendFrom), lte(hours.shiftDate, period.to),
        eq(users.role, 'volunteer'),
        includeTest ? undefined : eq(users.isTestAccount, false))))
      .map(({ entry, actorFirst, actorLast }) => ({ ...entry, enteredByName: `${actorFirst} ${actorLast}`.trim() }));
    const schedule = await readScheduleData(tx, undefined, { from: period.from, to: period.to });
    const report = buildHoursReport(people, entries, schedule, now, month, includeTest);
    return { report, people, entries, schedule };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
