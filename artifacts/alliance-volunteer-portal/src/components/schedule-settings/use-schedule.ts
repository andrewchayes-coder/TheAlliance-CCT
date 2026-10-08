import { useQueryClient } from '@tanstack/react-query';
import { getGetScheduleSettingsQueryKey, type ScheduleSettings } from '@workspace/api-client-react';

/** Push a full settings response into cache and mark dependent private data stale. */
export function useScheduleSync() {
  const qc = useQueryClient();
  return (s: ScheduleSettings) => {
    qc.setQueryData(getGetScheduleSettingsQueryKey(), s);
    void qc.invalidateQueries({
      predicate: q => {
        const k = q.queryKey[0];
        return typeof k === 'string' && (k.startsWith('/api/admin/volunteers') || k.startsWith('/api/admin/overview') || k.startsWith('/api/admin/schedule/week') || k.startsWith('/api/volunteer/dashboard'));
      },
    });
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function emailText(s: ScheduleSettings): string {
  const e = s.emailSummary;
  if (!e || e.sent + e.logged + e.failed === 0) return '';
  const parts: string[] = [];
  if (e.sent) parts.push(`${plural(e.sent, 'email')} sent`);
  if (e.logged) parts.push(`${plural(e.logged, 'email')} logged for testing and not sent`);
  if (e.failed) parts.push(`${plural(e.failed, 'email')} failed to send, so contact those volunteers directly`);
  return ` ${parts.join('; ')}.`;
}

export const addHours = (t: string, h: number): string => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return '';
  const [hh, mm] = t.split(':').map(Number);
  const total = hh + h;
  return total > 23 ? '' : `${String(total).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
export const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  a.startTime < b.endTime && a.endTime > b.startTime;
