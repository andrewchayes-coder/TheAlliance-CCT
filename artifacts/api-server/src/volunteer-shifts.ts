import { appConfig } from '@workspace/shared/appConfig';

export type AssignedSlot = {
  assignmentId: string; startDate: string; endDate: string | null;
  dayOfWeek: number; startTime: string; endTime: string; label: string | null;
};
export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: appConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addCalendarDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
/** Convert a Pacific local slot time into an instant without hardcoding a DST offset. */
export function slotInstant(day: string, time: string): Date {
  const target = Date.parse(`${day}T${time}:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: appConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += target - represented;
  }
  return new Date(instant);
}

export function upcomingOccurrences(slots: AssignedSlot[], closed: Set<string>, skips: Set<string>, now = new Date(), limit = 4) {
  const first = pacificDay(now);
  const occurrences = [];
  for (let offset = 0; offset < 366 && occurrences.length < limit; offset++) {
    const date = addCalendarDays(first, offset);
    if (closed.has(date)) continue;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const eligible = slots.filter(slot => slot.dayOfWeek === weekday && slot.startDate <= date &&
      (!slot.endDate || slot.endDate >= date) && !skips.has(`${slot.assignmentId}:${date}`))
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.assignmentId.localeCompare(b.assignmentId));
    for (const slot of eligible) {
      const startsAt = slotInstant(date, slot.startTime);
      const endsAt = slotInstant(date, slot.endTime);
      if (endsAt <= now) continue;
      occurrences.push({ assignmentId: slot.assignmentId, date, startTime: slot.startTime, endTime: slot.endTime,
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), label: slot.label });
      if (occurrences.length === limit) break;
    }
  }
  return occurrences;
}
