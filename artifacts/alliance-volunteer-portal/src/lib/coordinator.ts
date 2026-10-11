import { clock, TZ } from '@/components/volunteer-detail/format';
import type { CoordinatorBlock } from '@workspace/api-client-react';
import { testScheduleLabel } from '@workspace/shared/testAccounts';

export const POLL = {
  staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: true as const, retry: false as const,
};
export const updatedLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const activityTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const noon = (d: string) => new Date(`${d}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const mondayOf = (d: string) => { const dow = noon(d).getUTCDay(); return addDays(d, dow === 0 ? -6 : 1 - dow); };
export const validDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(noon(s).getTime()) && iso(noon(s)) === s;
export const dayLabel = (d: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  noon(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
export const range = (b: CoordinatorBlock) => `${clock(b.startTime)} to ${clock(b.endTime)}`;
type Person = { firstName: string; lastName: string; email?: string; isTestAccount?: boolean };
export const shortName = (v: Person) => testScheduleLabel(v) ?? `${v.firstName} ${v.lastName.trim().charAt(0)}.`.trim();
export const fullName = (v: Person) => testScheduleLabel(v) ?? `${v.firstName} ${v.lastName}`.trim();
export const activeVols = (b: CoordinatorBlock) => b.volunteers.filter(v => !v.skipped);

export const ACTIONS: Record<string, string> = {
  status_changed: 'Status changed', certification_updated: 'Certification updated',
  background_check_updated: 'Background check updated', shift_slot_deactivated: 'Shift slot deactivated',
  admin_notes_updated: 'Admin notes updated', tracking_updated: 'Tracking updated',
  shift_assigned: 'Shift assigned', shift_released: 'Shift released', shift_skipped: 'Shift skipped',
};
export const humanize = (a: string) => ACTIONS[a] ?? (a.replace(/[_.-]+/g, ' ').trim().replace(/^./, c => c.toUpperCase()) || 'Updated');

/** Interval partitioning: transitive overlap groups, greedy lanes inside each group. */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/** Standard regular grid: 2-hour slot starting on a whole hour 9..16. */
export const isStandardRegular = (b: CoordinatorBlock) =>
  b.kind !== 'custom' && toMin(b.startTime) % 60 === 0 && toMin(b.endTime) - toMin(b.startTime) === 120 && toMin(b.startTime) >= 540 && toMin(b.startTime) <= 960;
/** Explicit lane: odd start hour = lane A (0), even start hour = lane B (1). */
export const standardLane = (b: CoordinatorBlock) => (toMin(b.startTime) / 60) % 2 === 1 ? 0 : 1;

export function layoutBlocks(blocks: CoordinatorBlock[]) {
  if (blocks.some(isStandardRegular)) {
    const placed: { b: CoordinatorBlock; lane: number }[] = blocks.filter(isStandardRegular).map(b => ({ b, lane: standardLane(b) }));
    const rest = blocks.filter(b => !isStandardRegular(b)).sort((a, b) => a.startTime.localeCompare(b.startTime) || b.endTime.localeCompare(a.endTime));
    for (const b of rest) {
      let lane = 0;
      while (placed.some(p => p.lane === lane && p.b.startTime < b.endTime && p.b.endTime > b.startTime)) lane++;
      placed.push({ b, lane });
    }
    const lanes = Math.max(2, ...placed.map(p => p.lane + 1));
    return placed.map(p => ({ ...p, lanes }));
  }
  const s = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime) || b.endTime.localeCompare(a.endTime));
  const out: { b: CoordinatorBlock; lane: number; lanes: number }[] = [];
  let group: { b: CoordinatorBlock; lane: number }[] = []; let gEnd = '';
  const flush = () => { const n = group.reduce((m, g) => Math.max(m, g.lane + 1), 1); group.forEach(g => out.push({ ...g, lanes: n })); group = []; };
  const laneEnds: string[] = [];
  for (const b of s) {
    if (group.length && b.startTime >= gEnd) { flush(); laneEnds.length = 0; gEnd = ''; }
    let lane = laneEnds.findIndex(e => e <= b.startTime);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = b.endTime;
    group.push({ b, lane });
    if (b.endTime > gEnd) gEnd = b.endTime;
  }
  if (group.length) flush();
  return out;
}

/** Shared time rows expand locally to fit content, without lengthening a block past its end. */
export function timeGeometry(blocks: CoordinatorBlock[]) {
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = Math.floor(Math.min(540, ...blocks.map(b => minutes(b.startTime))) / 60) * 60;
  const end = Math.ceil(Math.max(1080, ...blocks.map(b => minutes(b.endTime))) / 60) * 60;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const halves = hours.slice(0, -1).map(h => h + 30);
  const ticks = [...new Set([...hours, ...halves, ...blocks.flatMap(b => [minutes(b.startTime), minutes(b.endTime)])])].sort((a, b) => a - b);
  const heights = ticks.slice(1).map((t, i) => (t - ticks[i]!) * 1.2);
  for (const b of blocks) {
    const from = ticks.indexOf(minutes(b.startTime)), to = ticks.indexOf(minutes(b.endTime));
    const natural = heights.slice(from, to).reduce((n, h) => n + h, 0);
    const needed = 62 + (b.label ? 16 : 0) + (b.state !== 'covered' ? 16 : 0) + b.volunteers.length * 16 + b.volunteers.filter(v => v.skipped).length * 16;
    const extra = Math.max(0, needed - natural);
    for (let i = from; i < to; i++) heights[i] = heights[i]! + extra * (ticks[i + 1]! - ticks[i]!) / (ticks[to]! - ticks[from]!);
  }
  const offsets = [0]; heights.forEach(h => offsets.push(offsets[offsets.length - 1]! + h));
  return { hours, height: offsets[offsets.length - 1]!, position: (minute: number) => offsets[ticks.indexOf(minute)]! };
}
