import { and, eq, gte, inArray, isNull, ne, or, getTableColumns, desc, sql } from 'drizzle-orm';
import {
  db, usersTable, volunteerProfilesTable, shiftAssignmentsTable, shiftSlotsTable, shiftSkipsTable, userPublicSchema, activityLogTable,
} from '@workspace/db';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { csvCell } from './onboarding';
import { pacificDay } from './volunteer-shifts';
import { attentionReasons, type AttentionReason } from './volunteer-attention';
import { appConfig } from '@workspace/shared/appConfig';
import { normalizeVolunteerStatus, missingProfileFields } from '@workspace/shared/profileFields';
import {customShiftsTable,customShiftAssignmentsTable} from '@workspace/db';
import {slotInstant} from './server/scheduleService';
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
    const onboardingEvents = await tx.selectDistinctOn([activityLogTable.volunteerProfileId], {
      profileId:activityLogTable.volunteerProfileId,createdAt:activityLogTable.createdAt,
    }).from(activityLogTable).where(and(
      inArray(activityLogTable.volunteerProfileId,people.map(row=>row.profile.id)),
      eq(activityLogTable.action,'status_changed'),sql`${activityLogTable.details}->>'to' = 'onboarding'`,
    )).orderBy(activityLogTable.volunteerProfileId,desc(activityLogTable.createdAt));
    const onboardingSince = new Map(onboardingEvents.map(event=>[event.profileId,event.createdAt]));
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
      return { user, profile: { ...profile, status: normalizeVolunteerStatus(profile.status) }, shifts, shiftCount: shifts.length,
        attention: attentionReasons({...profile,onboardingSince:onboardingSince.get(profile.id)}, shifts.length, today,user) };
    });
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
export type RosterPerson = Awaited<ReturnType<typeof rosterSnapshot>>[number];
export type RosterFilters = {
  search?: string; status?: string; county?: string; certificationStatus?: string; backgroundCheckStatus?: string;
  needsAttention?: 'any' | AttentionReason;
  showTestAccounts?: 'true' | 'false';
  city?: string; shiftPresence?: 'has_shift' | 'no_shift'; profileIncomplete?: 'true' | 'false';
  sortBy?: 'name' | 'status' | 'phone' | 'email' | 'city' | 'startDate' | 'shiftCount' | 'lastLoginAt' | 'dateOfBirth' | 'address' | 'zip' | 'emergencyContact' | 'county';
  sortDirection?: 'asc' | 'desc';
};
export function filterRoster(people: RosterPerson[], filters: RosterFilters) {
  const search = filters.search?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const phoneSearch = search && /^[+\d()\s.-]+$/.test(search) ? search.replace(/\D/g, '') : '';
  return people.filter(({ user, profile, attention, shiftCount }) => {
    if (user.isTestAccount && filters.showTestAccounts !== 'true') return false;
    if (filters.status && normalizeVolunteerStatus(profile.status) !== filters.status) return false;
    if (filters.county && profile.county !== filters.county) return false;
    if (filters.city && profile.city !== filters.city) return false;
    if (filters.shiftPresence === 'has_shift' && shiftCount === 0) return false;
    if (filters.shiftPresence === 'no_shift' && shiftCount !== 0) return false;
    const incomplete = !profile.onboardingCompletedAt || missingProfileFields(user,profile).length > 0;
    if (filters.profileIncomplete && incomplete !== (filters.profileIncomplete === 'true')) return false;
    if (appConfig.trackCertificationInApp && filters.certificationStatus && profile.certificationStatus !== filters.certificationStatus) return false;
    if (appConfig.trackBackgroundCheckInApp && filters.backgroundCheckStatus && profile.backgroundCheckStatus !== filters.backgroundCheckStatus) return false;
    if (filters.needsAttention && (filters.needsAttention === 'any' ? !attention.length : !attention.includes(filters.needsAttention))) return false;
    if (!search) return true;
    return [`${user.firstName} ${user.lastName}`, `${user.lastName} ${user.firstName}`, user.email, user.phone ?? '']
      .some(text => text.toLowerCase().replace(/\s+/g, ' ').includes(search)) ||
      !!(phoneSearch && user.phone?.replace(/\D/g, '').includes(phoneSearch));
  });
}
/** Sort the full filtered snapshot before pagination, with deterministic ties and empty values last. */
export function sortRoster(people: RosterPerson[], filters: RosterFilters) {
  const key = filters.sortBy ?? 'name', direction = filters.sortDirection === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('en-US',{numeric:true,sensitivity:'base'});
  const value = (person:RosterPerson):string|number|null => {
    const {user,profile,shiftCount}=person;
    switch(key) {
      case 'name':return `${user.lastName} ${user.firstName}`;
      case 'phone':return user.phone;
      case 'email':return user.email;
      case 'status':return normalizeVolunteerStatus(profile.status);
      case 'shiftCount':return shiftCount;
      case 'lastLoginAt':return user.lastLoginAt?.getTime() ?? null;
      case 'address':return [profile.addressLine1,profile.city,profile.state,profile.zip].filter(Boolean).join(', ') || null;
      case 'emergencyContact':return [profile.emergencyContactName,profile.emergencyContactRelationship,profile.emergencyContactPhone].filter(Boolean).join(' ') || null;
      default:return profile[key] ?? null;
    }
  };
  return [...people].sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av === null || av === '') return bv === null || bv === '' ? a.user.id.localeCompare(b.user.id) : 1;
    if(bv === null || bv === '') return -1;
    const compared = typeof av === 'number' && typeof bv === 'number' ? av-bv : collator.compare(String(av),String(bv));
    return compared*direction || a.user.id.localeCompare(b.user.id);
  });
}
export function rosterEntry(person: RosterPerson) {
  const { adminNotes: _, ...profile } = person.profile;
  return { user: userPublicSchema.parse(person.user), profile: { ...profile,status:normalizeVolunteerStatus(profile.status) }, shiftCount: person.shiftCount, attention: person.attention };
}
export function rosterSummary(people: RosterPerson[]) {
  const counts = { onboarding: 0, active: 0, inactive: 0, needsAttention: 0 };
  for (const person of people) {
    if (person.user.isTestAccount) continue;
    counts[normalizeVolunteerStatus(person.profile.status)]++;
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
  const fields = (Object.keys(getTableColumns(volunteerProfilesTable)) as Array<keyof Profile>).filter(key =>
    (!key.startsWith('certification') || appConfig.trackCertificationInApp) &&
    (!key.startsWith('backgroundCheck') || appConfig.trackBackgroundCheckInApp) &&
    (!key.startsWith('agreement') || appConfig.requireAgreementAcknowledgment) &&
    (key !== 'onboardingAnswers' || onboardingQuestions.length > 0));
  const headers = ['First name', 'Last name', 'Email', 'Phone', 'Email verified at', 'Last login', 'Account active',
    ...fields.map(key => `Profile: ${key}`), ...onboardingQuestions.map(q => `Answer: ${q.label} (${q.id})`), 'Shifts held'];
  return csv(headers, people.filter(p => !p.user.isTestAccount).map(person => [person.user.firstName, person.user.lastName, person.user.email, person.user.phone,
    person.user.emailVerifiedAt?.toISOString(), person.user.lastLoginAt?.toISOString(), person.user.isActive,
    ...fields.map(key => {
      const value = person.profile[key];
      return value instanceof Date ? value.toISOString() : typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    }), ...onboardingQuestions.map(q => formatOnboardingAnswer(person.profile.onboardingAnswers[q.id])), heldShiftsText(person)]));
}
export async function customCsvRows(people:RosterPerson[],now=new Date()) {
  const real=people.filter(p=>!p.user.isTestAccount);
  if(!real.length)return [];
  const rows=await db.select({shift:customShiftsTable,assignment:customShiftAssignmentsTable})
    .from(customShiftAssignmentsTable).innerJoin(customShiftsTable,eq(customShiftsTable.id,customShiftAssignmentsTable.customShiftId))
    .where(and(inArray(customShiftAssignmentsTable.volunteerProfileId,real.map(p=>p.profile.id)),isNull(customShiftsTable.cancelledAt),isNull(customShiftAssignmentsTable.cancelledAt)));
  return rows.filter(row=>slotInstant(row.shift.date,row.shift.endTime)>now).map(({shift,assignment})=>{
    const p=real.find(p=>p.profile.id===assignment.volunteerProfileId)!;
    return [`${p.user.firstName} ${p.user.lastName}`,p.user.email,p.profile.id,assignment.id,
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(`${shift.date}T00:00:00Z`).getUTCDay()],
      shift.startTime,shift.endTime,shift.date,shift.date,'','One-time',shift.label??''];
  });
}
export function scheduleCsv(people: RosterPerson[],customRows:string[][]=[]) {
  return csv(['Volunteer', 'Email', 'Profile ID', 'Assignment ID', 'Day', 'Start time', 'End time', 'Start date', 'End date', 'Upcoming skip dates','Shift type','Label'],
    [...people.filter(p => !p.user.isTestAccount).flatMap(person => person.shifts.map(shift => [
      `${person.user.firstName} ${person.user.lastName}`, person.user.email, person.profile.id, shift.assignmentId,
      weekdays[shift.dayOfWeek], shift.startTime, shift.endTime, shift.startDate, shift.endDate,
      shift.upcomingSkipDates.join('; '),'Weekly',shift.label??'',
    ])),...customRows]);
}
