import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import { db, volunteerProfilesTable as profiles, volunteerHoursTable as hours,
  usersTable as users, activityLogTable as activity } from '@workspace/db';
import { z } from 'zod';
import { appConfig, volunteerContactText } from '@workspace/shared/appConfig';
import { AddAdminVolunteerHoursBody, PutVolunteerHoursBody } from '@workspace/api-zod';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { readScheduleData, type ScheduleTransaction } from './scheduleRepository';
import { addCalendarDays, calendarDay, pacificDay } from './scheduleService';
import { loggableShifts, sameHoursShift, type HoursSource } from './volunteerHours';

const invalidAmount = 'Enter hours between 0.25 and 12, in quarter hours (for example 1.5).';
const ownOnly = `You can only log hours for your own shifts from the last ${appConfig.hoursLogWindowDays} days. For anything else, contact ${volunteerContactText}.`;
export class HoursError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const inputSchema = z.object({
  date: z.string().refine(value => { try { calendarDay(value); return true; } catch { return false; } }, 'Choose a valid calendar date.'),
  source: z.enum(['standing', 'one_time', 'other']),
  shiftSlotId: z.string().uuid().optional(),
  customShiftId: z.string().uuid().optional(),
  hours: z.number().finite().refine(n => n >= appConfig.hoursIncrement && n <= appConfig.hoursMax &&
    Number.isInteger(n / appConfig.hoursIncrement), invalidAmount),
  note: z.string().trim().max(300, 'Keep your note to 300 characters or fewer.').optional(),
}).strict().superRefine((v, ctx) => {
  if (v.source === 'standing' ? !v.shiftSlotId || !!v.customShiftId :
    v.source === 'one_time' ? !v.customShiftId || !!v.shiftSlotId : !!v.shiftSlotId || !!v.customShiftId) {
    ctx.addIssue({ code: 'custom', message: 'Choose the scheduled shift for these hours.' });
  }
  if (v.source === 'other' && !v.note?.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'What was this time for?' });
});
type Input = z.infer<typeof inputSchema>;
export function validateHoursInput(value: unknown, staff: boolean): Input {
  // Friendly domain errors take precedence over generated schema messages.
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new HoursError(422, parsed.error.issues[0]!.message);
  if (!staff && parsed.data.source === 'other') throw new HoursError(422, ownOnly);
  const contract = staff ? AddAdminVolunteerHoursBody : PutVolunteerHoursBody;
  if (!contract.safeParse(value).success) throw new HoursError(422, 'Please check the hours entry.');
  return parsed.data;
}
type Row = typeof hours.$inferSelect;
/** Numeric conversion happens only here, before any row or aggregate reaches a client. */
function numberRow(row: Row) { return { ...row, hours: Number(row.hours) }; }
function publicRow(row: Row, enteredBy: string) {
  const converted = numberRow(row);
  return { id: converted.id, date: converted.shiftDate, source: converted.source as HoursSource,
    shiftSlotId: converted.shiftSlotId, customShiftId: converted.customShiftId,
    startTime: converted.startTime, endTime: converted.endTime, hours: converted.hours,
    note: converted.note, enteredBy, updatedAt: converted.updatedAt.toISOString() };
}
async function profileFor(tx: ScheduleTransaction, userId: string, lock = false) {
  const query = tx.select().from(profiles).where(eq(profiles.userId, userId));
  const [profile] = await (lock ? query.for('update') : query);
  if (!profile) throw new HoursError(404, 'This volunteer could not be found.');
  return profile;
}
function months(now: Date) {
  const today = pacificDay(now), thisStart = `${today.slice(0, 7)}-01`;
  const lastStart = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  return { today, thisStart, lastStart };
}
async function totals(tx: ScheduleTransaction, profileId: string, now: Date) {
  const { today, thisStart, lastStart } = months(now);
  const rows = await tx.select().from(hours).where(and(eq(hours.volunteerProfileId, profileId),
    gte(hours.shiftDate, lastStart), lte(hours.shiftDate, today)));
  const converted = rows.map(numberRow);
  return {
    thisMonthTotal: converted.filter(r => r.shiftDate >= thisStart).reduce((n, r) => n + r.hours, 0),
    lastMonthTotal: converted.filter(r => r.shiftDate < thisStart).reduce((n, r) => n + r.hours, 0),
  };
}
export async function volunteerHours(userId: string, now: Date) {
  return db.transaction(async tx => {
    const p = await profileFor(tx, userId);
    const today = pacificDay(now), from = addCalendarDays(today, 1 - appConfig.hoursLogWindowDays);
    const schedule = await readScheduleData(tx, p.id, { from, to: today });
    const shifts = loggableShifts(schedule, p.id, p.status, now);
    const rows = await tx.select().from(hours).where(and(eq(hours.volunteerProfileId, p.id),
      gte(hours.shiftDate, from), lte(hours.shiftDate, today)));
    const total = await totals(tx, p.id, now);
    const [history] = await tx.select({ id: hours.id }).from(hours).where(eq(hours.volunteerProfileId, p.id)).limit(1);
    const onboarding = normalizeVolunteerStatus(p.status) === 'onboarding';
    return { windowDays: appConfig.hoursLogWindowDays, monthTotal: onboarding ? 0 : total.thisMonthTotal,
      hasLoggedHours: !onboarding && !!history,
      shifts: shifts.map(s => {
        const row = rows.find(r => sameHoursShift(s, { ...r, date: r.shiftDate }));
        return { ...s, editable: true, logged: row ? { hours: numberRow(row).hours, note: row.note,
          enteredBy: row.enteredByUserId === userId ? 'volunteer' as const : 'staff' as const,
          updatedAt: row.updatedAt.toISOString() } : null };
      }) };
  }, { isolationLevel: 'repeatable read' });
}
export async function adminHours(userId: string, now: Date, range?: { from: string; to: string }) {
  const today = pacificDay(now), from = range?.from ?? addCalendarDays(today, -89), to = range?.to ?? today;
  calendarDay(from); calendarDay(to);
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new HoursError(422, 'Choose an ordered date range of no more than one year.');
  return db.transaction(async tx => {
    const p = await profileFor(tx, userId);
    const rows = await tx.select({ row: hours, firstName: users.firstName, lastName: users.lastName })
      .from(hours).innerJoin(users, eq(users.id, hours.enteredByUserId))
      .where(and(eq(hours.volunteerProfileId, p.id), gte(hours.shiftDate, from), lte(hours.shiftDate, to)))
      .orderBy(sql`${hours.shiftDate} desc`, sql`${hours.startTime} desc nulls last`, hours.id);
    const schedule = await readScheduleData(tx, p.id, { from, to });
    const unloggedShifts = loggableShifts(schedule, p.id, p.status, now, { from, to })
      .filter(s => !rows.some(({ row }) => sameHoursShift(s, { ...row, date: row.shiftDate })))
      .map(s => ({ ...s, logged: null, editable: true }));
    return { ...await totals(tx, p.id, now), rows: rows.map(({ row, firstName, lastName }) =>
      publicRow(row, row.enteredByUserId === userId ? 'Volunteer' : `${firstName} ${lastName}`.trim())), unloggedShifts };
  }, { isolationLevel: 'repeatable read' });
}
async function writeActivity(tx: ScheduleTransaction, profileId: string, actorId: string, action: string,
  row: Row, staff: boolean) {
  await tx.insert(activity).values({ volunteerProfileId: profileId, actorUserId: actorId, action,
    details: { shiftDate: row.shiftDate, source: row.source, hours: numberRow(row).hours, by: staff ? 'staff' : 'volunteer' } });
}
export async function saveHours(userId: string, actorId: string, raw: unknown, now: Date,
  staff = false, id?: string) {
  if (!appConfig.hoursLogging) throw new HoursError(404, 'Hour logging is not available.');
  const input = validateHoursInput(raw, staff);
  if (input.date > pacificDay(now)) throw new HoursError(422, staff ? "Hours can't be logged for a future date." : ownOnly);
  return db.transaction(async tx => {
    // Serialize all changes for this volunteer, including staff/volunteer races.
    const p = await profileFor(tx, userId, true);
    const [existing] = id ? await tx.select().from(hours).where(and(eq(hours.id, id), eq(hours.volunteerProfileId, p.id))) : [];
    if (id && !existing) throw new HoursError(404, 'This hours entry could not be found.');
    let startTime: string | null = null, endTime: string | null = null;
    if (input.source !== 'other') {
      if (staff && existing && sameHoursShift(input, { ...existing, date: existing.shiftDate })) {
        startTime = existing.startTime; endTime = existing.endTime;
      } else {
        const from = staff ? input.date : addCalendarDays(pacificDay(now), 1 - appConfig.hoursLogWindowDays);
        if (input.date < from) throw new HoursError(422, ownOnly);
        const schedule = await readScheduleData(tx, p.id, { from, to: staff ? input.date : pacificDay(now) });
        const occurrence = loggableShifts(schedule, p.id, p.status, now,
          staff ? { from: input.date, to: input.date } : undefined).find(s => sameHoursShift(s, input));
        if (!occurrence) throw new HoursError(422, staff ? 'Choose one of this volunteer’s ended shifts, or select Other time.' : ownOnly);
        startTime = occurrence.startTime; endTime = occurrence.endTime;
      }
    }
    const sameKey = input.source === 'standing'
      ? and(eq(hours.shiftSlotId, input.shiftSlotId!), eq(hours.shiftDate, input.date))
      : input.source === 'one_time' ? eq(hours.customShiftId, input.customShiftId!) : undefined;
    const [duplicate] = sameKey ? await tx.select().from(hours).where(and(eq(hours.volunteerProfileId, p.id), sameKey,
      id ? ne(hours.id, id) : undefined)) : [];
    if (staff && duplicate) throw new HoursError(409, 'Hours are already logged for that shift. Edit the existing entry instead.');
    const values = { volunteerProfileId: p.id, shiftDate: input.date, source: input.source,
      shiftSlotId: input.shiftSlotId ?? null, customShiftId: input.customShiftId ?? null,
      startTime, endTime, hours: input.hours.toFixed(2), note: input.note?.trim() || null, enteredByUserId: actorId };
    let row: Row;
    if (id) [row] = await tx.update(hours).set({ ...values, updatedAt: new Date() }).where(eq(hours.id, id)).returning();
    else if (!staff) {
      const target = input.source === 'standing' ? [hours.volunteerProfileId, hours.shiftSlotId, hours.shiftDate]
        : [hours.volunteerProfileId, hours.customShiftId];
      [row] = await tx.insert(hours).values(values).onConflictDoUpdate({ target,
        targetWhere: input.source === 'standing' ? sql`${hours.shiftSlotId} is not null` : sql`${hours.customShiftId} is not null`,
        set: { ...values, updatedAt: new Date() } }).returning();
    } else [row] = await tx.insert(hours).values(values).returning();
    await writeActivity(tx, p.id, actorId, existing || duplicate ? 'hours_updated' : 'hours_logged', row!, staff);
    const [actor] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, actorId));
    return publicRow(row!, staff ? `${actor!.firstName} ${actor!.lastName}`.trim() : 'Volunteer');
  });
}
export async function removeHours(userId: string, actorId: string, id: string) {
  return db.transaction(async tx => {
    const p = await profileFor(tx, userId, true);
    const [row] = await tx.delete(hours).where(and(eq(hours.id, id), eq(hours.volunteerProfileId, p.id))).returning();
    if (!row) throw new HoursError(404, 'This hours entry could not be found.');
    await writeActivity(tx, p.id, actorId, 'hours_deleted', row, true);
  });
}
