import { and, eq, gte, inArray, isNull, ne, or, getTableColumns } from 'drizzle-orm';
import {
  db, usersTable, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, shiftSkipsTable, userPublicSchema,
} from '@workspace/db';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { csvCell } from './onboarding';
import { pacificDay } from './volunteer-shifts';
import { attentionReasons, type AttentionReason } from './volunteer-attention';
export { attentionReasons, type AttentionReason } from './volunteer-attention';

type Profile = typeof volunteerProfilesTable.$inferSelect;

/** A single consistent snapshot; no per-volunteer queries or persistent private-data cache. */
export async function rosterSnapshot(now = new Date()) {
  const today = pacificDay(now);
  return db.transaction(async tx => {
    const people = await tx.select({ user: usersTable, profile: volunteerProfilesTable }).from(volunteerProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, volunteerProfilesTable.userId))
      .where(eq(usersTable.role, 'volunteer')).orderBy(usersTable.lastName, usersTable.firstName, usersTable.id);
    if (!people.length) return [];
    const assignments = await tx.select({
      profileId: shiftAssignmentsTable.volunteerProfileId, assignmentId: shiftAssignmentsTable.id,
      dayOfWeek: shiftSlotsTable.dayOfWeek, startTime: shiftSlotsTable.startTime, endTime: shiftSlotsTable.endTime,
      label: shiftSlotsTable.label, startDate: shiftAssignmentsTable.startDate, endDate: shiftAssignmentsTable.endDate,
    }).from(shiftAssignmentsTable).innerJoin(shiftSlotsTable, eq(shiftSlotsTable.id, shiftAssignmentsTable.shiftSlotId))
      .where(and(inArray(shiftAssignmentsTable.volunteerProfileId, people.map(row => row.profile.id)),
        eq(shiftSlotsTable.isActive, true), or(isNull(shiftSlotsTable.retireAfterDate), gte(shiftSlotsTable.retireAfterDate, today)),
        or(isNull(shiftAssignmentsTable.endedReason), ne(shiftAssignmentsTable.endedReason, 'admin_removed')),
        or(isNull(shiftAssignmentsTable.endDate), gte(shiftAssignmentsTable.endDate, today))))
      .orderBy(shiftSlotsTable.dayOfWeek, shiftSlotsTable.startTime, shiftAssignmentsTable.startDate, shiftAssignmentsTable.id);
    const skips = assignments.length ? await tx.select({ assignmentId: shiftSkipsTable.shiftAssignmentId, date: shiftSkipsTable.skipDate })
      .from(shiftSkipsTable).where(and(inArray(shiftSkipsTable.shiftAssignmentId, assignments.map(row => row.assignmentId)), gte(shiftSkipsTable.skipDate, today)))
      .orderBy(shiftSkipsTable.skipDate) : [];
    const skipMap = new Map<string, string[]>();
    for (const skip of skips) {
      const dates = skipMap.get(skip.assignmentId) ?? [];
      dates.push(skip.date); skipMap.set(skip.assignmentId, dates);
    }
    const byProfile = new Map<string, typeof assignments>();
    for (const assignment of assignments) {
      const held = byProfile.get(assignment.profileId) ?? [];
      held.push(assignment); byProfile.set(assignment.profileId, held);
    }
    return people.map(({ user, profile }) => {
      const shifts = (byProfile.get(profile.id) ?? []).map(({ profileId: _, ...shift }) => ({
        ...shift, upcomingSkipDates: (skipMap.get(shift.assignmentId) ?? []).filter(date =>
          date >= shift.startDate && (!shift.endDate || date <= shift.endDate)),
      }));
      return { user, profile, shifts, shiftCount: shifts.length, attention: attentionReasons(profile, shifts.length, today) };
    });
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
export type RosterPerson = Awaited<ReturnType<typeof rosterSnapshot>>[number];
export type RosterFilters = {
  search?: string; status?: string; county?: string; certificationStatus?: string; backgroundCheckStatus?: string;
  needsAttention?: 'any' | AttentionReason;
  showTestAccounts?: 'true' | 'false';
};
export function filterRoster(people: RosterPerson[], filters: RosterFilters) {
  const search = filters.search?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const phoneSearch = search && /^[+\d()\s.-]+$/.test(search) ? search.replace(/\D/g, '') : '';
  return people.filter(({ user, profile, attention }) => {
    if (user.isTestAccount && filters.showTestAccounts !== 'true') return false;
    if (filters.status && profile.status !== filters.status) return false;
    if (filters.county && profile.county !== filters.county) return false;
    if (filters.certificationStatus && profile.certificationStatus !== filters.certificationStatus) return false;
    if (filters.backgroundCheckStatus && profile.backgroundCheckStatus !== filters.backgroundCheckStatus) return false;
    if (filters.needsAttention && (filters.needsAttention === 'any' ? !attention.length : !attention.includes(filters.needsAttention))) return false;
    if (!search) return true;
    return [`${user.firstName} ${user.lastName}`, `${user.lastName} ${user.firstName}`, user.email, user.phone ?? '']
      .some(text => text.toLowerCase().replace(/\s+/g, ' ').includes(search)) ||
      !!(phoneSearch && user.phone?.replace(/\D/g, '').includes(phoneSearch));
  });
}
export function rosterEntry(person: RosterPerson) {
  const { adminNotes: _, ...profile } = person.profile;
  return { user: userPublicSchema.parse(person.user), profile, shiftCount: person.shiftCount, attention: person.attention };
}
export function rosterSummary(people: RosterPerson[]) {
  const counts = { applicant: 0, in_training: 0, active: 0, inactive: 0, needsAttention: 0 };
  for (const person of people) {
    if (person.user.isTestAccount) continue;
    counts[person.profile.status]++;
    if (person.attention.length) counts.needsAttention++;
  }
  return counts;
}
const weekdays = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const heldShiftsText = (person: RosterPerson) => person.shifts.map(shift =>
  `${weekdays[shift.dayOfWeek]} ${shift.startTime.replace(/^0(\d):/, '$1:')}–${shift.endTime.replace(/^0(\d):/, '$1:')}`).join('; ');
function csv(headers: string[], rows: unknown[][]) {
  return '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function rosterCsv(people: RosterPerson[]) {
  // Include all profile fields (including the raw answer JSON for legacy answers),
  // plus individual columns driven by the current question configuration.
  const fields = Object.keys(getTableColumns(volunteerProfilesTable)) as Array<keyof Profile>;
  const headers = ['First name', 'Last name', 'Email', 'Phone', 'Email verified at', 'Last login', 'Account active',
    ...fields.map(key => `Profile: ${key}`), ...onboardingQuestions.map(q => `Answer: ${q.label} (${q.id})`), 'Shifts held'];
  return csv(headers, people.filter(p => !p.user.isTestAccount).map(person => [person.user.firstName, person.user.lastName, person.user.email, person.user.phone,
    person.user.emailVerifiedAt?.toISOString(), person.user.lastLoginAt?.toISOString(), person.user.isActive,
    ...fields.map(key => {
      const value = person.profile[key];
      return value instanceof Date ? value.toISOString() : typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    }), ...onboardingQuestions.map(q => formatOnboardingAnswer(person.profile.onboardingAnswers[q.id])), heldShiftsText(person)]));
}
export function scheduleCsv(people: RosterPerson[]) {
  return csv(['Volunteer', 'Email', 'Profile ID', 'Assignment ID', 'Day', 'Start time', 'End time', 'Start date', 'End date', 'Upcoming skip dates'],
    people.filter(p => !p.user.isTestAccount).flatMap(person => person.shifts.map(shift => [
      `${person.user.firstName} ${person.user.lastName}`, person.user.email, person.profile.id, shift.assignmentId,
      weekdays[shift.dayOfWeek], shift.startTime, shift.endTime, shift.startDate, shift.endDate,
      shift.upcomingSkipDates.join('; '),
    ])));
}
