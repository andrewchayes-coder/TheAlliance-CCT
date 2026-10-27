/** Reporting uses Pacific service dates, never the scheduling weekend roll-forward. */
export const REPORT_PRESETS = ['Today', 'This Week', 'Last Week', 'This Month', 'Last Month', 'Custom Range'] as const;
export type ReportPreset = typeof REPORT_PRESETS[number];
export function pacificReportDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-');
}
export function realReportDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function reportingRangeError(start: unknown, end: unknown, today: string): string | undefined {
  if (!start || !end) return 'Choose both a start date and an end date.';
  if (!realReportDate(start) || !realReportDate(end)) return 'Enter real calendar dates in YYYY-MM-DD format.';
  if (start > end) return 'The start date must be on or before the end date.';
  if (end > today) return 'Choose dates on or before today in Pacific time.';
  return undefined;
}
const offset = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function presetReportRange(preset: Exclude<ReportPreset, 'Custom Range'>, today: string) {
  const first = `${today.slice(0, 7)}-01`;
  const monday = offset(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  switch (preset) {
    case 'Today': return { startDate: today, endDate: today };
    case 'This Week': return { startDate: monday, endDate: today };
    case 'Last Week': return { startDate: offset(monday, -7), endDate: offset(monday, -1) };
    case 'This Month': return { startDate: first, endDate: today };
    case 'Last Month': return { startDate: `${offset(first, -1).slice(0, 7)}-01`, endDate: offset(first, -1) };
  }
}
