import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCoverageAlertSettingsQueryKey, useGetCoverageAlertSettings, useUpdateCoverageAlertSettings } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { calDate } from '@/components/volunteer-detail/format';
import { useInvalidateSchedule } from './use-controls';

export function DigestToggle() {
  const { request } = useAuth();
  const refresh = useInvalidateSchedule();
  const qc = useQueryClient();
  const q = useGetCoverageAlertSettings({ query: { queryKey: getGetCoverageAlertSettingsQueryKey(), staleTime: 0, retry: false }, request: FETCH_CREDS });
  const upd = useUpdateCoverageAlertSettings({ request });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const on = q.data?.dailyDigestEnabled ?? false;
  const toggle = () => {
    if (!q.data || upd.isPending) return;
    setMsg(null); setErr(null);
    upd.mutate({ data: { dailyDigestEnabled: !on } }, {
      onSuccess: s => { qc.setQueryData(getGetCoverageAlertSettingsQueryKey(), s); setMsg(s.dailyDigestEnabled ? 'Daily coverage digest is on.' : 'Daily coverage digest is off.'); void refresh(); },
      onError: e => setErr(readError(e).message),
    });
  };
  return (
    <section className="alliance-card mt-4" aria-labelledby="digest-h" data-testid="section-digest">
      <h2 id="digest-h" className="alliance-display text-[15px]">Daily coverage digest</h2>
      <p className="mt-1 max-w-xl text-sm">At 7:00 AM Pacific, Monday–Friday, admins receive one combined email about shifts needing volunteers in the next seven days. No gaps means no email.</p>
      {q.isLoading && <Skeleton className="mt-3 h-11 w-full" />}
      {q.isError && <div className="mt-3"><Notice>{readError(q.error, "Something went wrong on our end. Please try again — if it keeps happening, let The Alliance know.").message}</Notice><Button type="button" onClick={() => { void q.refetch(); }} data-testid="button-retry-digest">Try again</Button></div>}
      {q.data && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" role="switch" aria-checked={on} onClick={toggle} disabled={upd.isPending} data-testid="switch-digest"
            className="inline-flex min-h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-1 text-sm font-bold focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60">
            <span className={`relative h-6 w-11 shrink-0 rounded-full ${on ? 'bg-teal-text' : 'bg-navy-soft'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} /></span>
            <span className="shrink-0 whitespace-nowrap">{upd.isPending ? 'Saving...' : on ? 'On' : 'Off'}</span>
          </button>
          <p className="text-xs text-navy-soft" data-testid="text-last-digest">{q.data.lastDigestDate ? `Last daily check ${calDate(q.data.lastDigestDate)}` : 'No daily check yet'}</p>
        </div>
      )}
      <div className="mt-2">{msg && <Notice kind="success">{msg}</Notice>}</div>
      {err && <div><Notice>{err}</Notice></div>}
    </section>
  );
}
