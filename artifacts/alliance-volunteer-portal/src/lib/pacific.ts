import { appConfig } from '@workspace/shared/appConfig';

const tz = appConfig.timezone;
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

export const pacificDate = (d: Date = new Date()) => dateFmt.format(d);
export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function dayLabel(ymd: string, now: Date = new Date()) {
  const today = pacificDate(now);
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function parts(t: string) {
  const [h, m] = t.split(':').map(Number);
  return { h12: h % 12 || 12, m: String(m).padStart(2, '0'), ap: h < 12 ? 'AM' : 'PM' };
}
export function timeRange(start: string, end: string) {
  const a = parts(start), b = parts(end);
  return a.ap === b.ap ? `${a.h12}:${a.m}–${b.h12}:${b.m} ${b.ap}` : `${a.h12}:${a.m} ${a.ap}–${b.h12}:${b.m} ${b.ap}`;
}
export const shiftWhen = (s: { date: string; startTime: string; endTime: string }, now?: Date) =>
  `${dayLabel(s.date, now)}, ${timeRange(s.startTime, s.endTime)}`;
export function shiftDate(ymd: string) {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}
export function countdown(s: { startsAt: string; endsAt: string }, now: Date = new Date()) {
  const start = Date.parse(s.startsAt), end = Date.parse(s.endsAt), t = now.getTime();
  if (t >= end) return 'This shift has ended';
  if (t >= start) return 'Your shift is happening now';
  const mins = Math.round((start - t) / 60000);
  if (mins < 60) return `Starts in ${Math.max(mins, 1)} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Starts in ${hrs} hr${hrs === 1 ? '' : 's'}`;
  const days = Math.floor(hrs / 24);
  return `Starts in ${days} day${days === 1 ? '' : 's'}`;
}
export function safeHttps(href: string | null | undefined): string | null {
  if (!href) return null;
  if (/^\/seed-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(href)) {
    return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${href}`;
  }
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function shortDateTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
