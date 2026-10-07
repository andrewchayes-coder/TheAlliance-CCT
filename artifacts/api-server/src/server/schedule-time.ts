export const TIME_ZONE = 'America/Los_Angeles';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const instantFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function pacificDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Enter a valid instant.');
  return dayFormatter.format(now);
}
export function calendarDay(day: string | Date): string {
  if (day instanceof Date) return pacificDay(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new RangeError('Enter a valid calendar date.');
  return day;
}
export function addCalendarDays(day: string, offset: number): string {
  const date = new Date(`${calendarDay(day)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
/** Weekday-only grid times cannot fall in Sunday's DST ambiguity/gap. */
export function slotInstant(day: string, time: string): Date {
  const target = Date.parse(`${calendarDay(day)}T${time}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(instantFormatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    instant += target - represented;
  }
  return new Date(instant);
}
