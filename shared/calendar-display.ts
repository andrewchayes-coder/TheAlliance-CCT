/** UI default only: do not use this to normalize an explicitly selected week. */
export function operatingWeekStart(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + (weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday));
  return day.toISOString().slice(0, 10);
}
export const shiftStartVerb = (startDate: string, today: string) => startDate > today ? 'Starts' : 'Started';
