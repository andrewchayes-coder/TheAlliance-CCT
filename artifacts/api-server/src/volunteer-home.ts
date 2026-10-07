import { and, count, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import {
  db, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, closedDatesTable, shiftSkipsTable,
  messagesTable, messageRecipientsTable, resourcesTable,
} from '@workspace/db';
import { safeResourceHref } from './onboarding';
import { upcomingOccurrences, pacificDay } from './volunteer-shifts';

const messageProjection = {
  id: messagesTable.id, recipientId: messageRecipientsTable.id, subject: messagesTable.subject,
  body: messagesTable.body, sentAt: messagesTable.sentAt, readAt: messageRecipientsTable.readAt,
};
export async function ownMessages(userId: string, unreadOnly = false) {
  const query = db.select(messageProjection).from(messageRecipientsTable)
    .innerJoin(messagesTable, eq(messageRecipientsTable.messageId, messagesTable.id))
    .where(and(eq(messageRecipientsTable.recipientUserId, userId), unreadOnly ? isNull(messageRecipientsTable.readAt) : undefined))
    .orderBy(desc(messagesTable.sentAt), messagesTable.id);
  return unreadOnly ? query.limit(1) : query;
}
export async function publishedVolunteerResources(active: boolean, quickOnly = false) {
  if (quickOnly && !active) return [];
  const rows = await db.select().from(resourcesTable).where(and(eq(resourcesTable.isPublished, true),
    quickOnly ? eq(resourcesTable.isQuickLink, true) : (!active ? eq(resourcesTable.isQuickLink, false) : undefined)))
    .orderBy(resourcesTable.sortOrder, resourcesTable.title, resourcesTable.id);
  return rows.map(row => ({
    id: row.id, title: row.title, type: row.type, summary: row.summary, category: row.category,
    body: row.type === 'article' ? row.body : null, href: safeResourceHref(row), isQuickLink: row.isQuickLink,
  }));
}
export async function volunteerDashboard(userId: string) {
  const [profile] = await db.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId));
  const active = profile?.status === 'active';
  const now = new Date();
  const today = pacificDay(now);
  const assignments = active && profile ? await db.select({
    assignmentId: shiftAssignmentsTable.id, startDate: shiftAssignmentsTable.startDate, endDate: shiftAssignmentsTable.endDate,
    dayOfWeek: shiftSlotsTable.dayOfWeek, startTime: shiftSlotsTable.startTime, endTime: shiftSlotsTable.endTime, label: shiftSlotsTable.label,
  }).from(shiftAssignmentsTable).innerJoin(shiftSlotsTable, eq(shiftSlotsTable.id, shiftAssignmentsTable.shiftSlotId))
    .where(and(eq(shiftAssignmentsTable.volunteerProfileId, profile.id), eq(shiftSlotsTable.isActive, true),
      or(isNull(shiftAssignmentsTable.endedReason), ne(shiftAssignmentsTable.endedReason, 'admin_removed')),
      or(isNull(shiftAssignmentsTable.endDate), gte(shiftAssignmentsTable.endDate, today)))) : [];
  const [closures, skips, quickLinks, unread, totals] = await Promise.all([
    assignments.length ? db.select({ date: closedDatesTable.date }).from(closedDatesTable).where(gte(closedDatesTable.date, today)) : [],
    assignments.length ? db.select({ assignmentId: shiftSkipsTable.shiftAssignmentId, date: shiftSkipsTable.skipDate }).from(shiftSkipsTable)
      .where(and(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(row => row.assignmentId)), gte(shiftSkipsTable.skipDate, today))) : [],
    publishedVolunteerResources(active, true), ownMessages(userId, true),
    db.select({ total: count() }).from(messageRecipientsTable)
      .where(and(eq(messageRecipientsTable.recipientUserId, userId), isNull(messageRecipientsTable.readAt))),
  ]);
  const upcomingShifts = upcomingOccurrences(assignments, new Set(closures.map(row => row.date)),
    new Set(skips.map(row => `${row.assignmentId}:${row.date}`)), now);
  return {
    shiftCount: assignments.length, nextShift: upcomingShifts[0] ?? null, upcomingShifts, quickLinks,
    unreadMessage: unread[0] ?? null, unreadCount: totals[0]?.total ?? 0, schedulingOpen: false,
  };
}
