import { eq, desc, and, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, usersTable, volunteerProfilesTable, activityLogTable } from '@workspace/db';
import { readScheduleData } from './scheduleRepository';
import { coordinatorProjection, mondayOf } from './coordinatorSchedule';
import { pacificDay, addCalendarDays } from './scheduleService';

export async function coordinatorSnapshot(weekStart?: string, now = new Date()) {
  return db.transaction(async tx => {
    const from = weekStart ? mondayOf(weekStart) : mondayOf(pacificDay(now));
    const data = await readScheduleData(tx, undefined, { from, ...(weekStart ? { to: addCalendarDays(from, 4) } : {}) });
    const rows = await tx.select({ userId: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName,
      email: usersTable.email, phone: usersTable.phone, accountActive: usersTable.isActive, isTestAccount: usersTable.isTestAccount, profileId: volunteerProfilesTable.id,
      profile: volunteerProfilesTable })
      .from(volunteerProfilesTable).innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(usersTable.role, 'volunteer'));
    const onboardingEvents = await tx.selectDistinctOn([activityLogTable.volunteerProfileId],{
      profileId:activityLogTable.volunteerProfileId,createdAt:activityLogTable.createdAt,
    }).from(activityLogTable).where(and(eq(activityLogTable.action,'status_changed'),
      sql`${activityLogTable.details}->>'to' = 'onboarding'`))
      .orderBy(activityLogTable.volunteerProfileId,desc(activityLogTable.createdAt));
    const since=new Map(onboardingEvents.map(event=>[event.profileId,event.createdAt]));
    const projection = coordinatorProjection(data, rows.map(row=>({...row,profile:{...row.profile,onboardingSince:since.get(row.profileId)}})), now);
    if (weekStart) return projection.week(weekStart);
    const actor = alias(usersTable, 'activity_actor'), volunteer = alias(usersTable, 'activity_volunteer');
    const events = await tx.select({ id: activityLogTable.id, userId: volunteer.id, firstName: volunteer.firstName,
      lastName: volunteer.lastName, actorFirst: actor.firstName, actorLast: actor.lastName,
      action: activityLogTable.action, createdAt: activityLogTable.createdAt }).from(activityLogTable)
      .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.id, activityLogTable.volunteerProfileId))
      .innerJoin(volunteer, eq(volunteer.id, volunteerProfilesTable.userId))
      .innerJoin(actor, eq(actor.id, activityLogTable.actorUserId))
      .orderBy(desc(activityLogTable.createdAt), desc(activityLogTable.id)).limit(15);
    return { ...projection.overview(), recentActivity: events.map(e => ({ id: e.id, userId: e.userId,
      volunteerName: `${e.firstName} ${e.lastName}`, actorName: `${e.actorFirst} ${e.actorLast}`,
      action: e.action, createdAt: e.createdAt.toISOString() })) };
  }, { isolationLevel: 'repeatable read' });
}
