import { SOMETHING_WENT_WRONG } from '@/lib/contact';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getGetNotificationLogQueryKey, getGetNotificationSummaryQueryKey, getGetReminderJobStatusQueryKey, useGetNotificationSummary } from '@workspace/api-client-react';
import { AppLayout, Button, Card } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS, readError } from '@/auth/auth-context';
import { Skeleton } from '@/components/ui/skeleton';
import { UsageChart } from '@/components/notifications/usage-chart';
import { ProviderCard, UsageCard } from '@/components/notifications/usage-cards';
import { LogSection } from '@/components/notifications/log-table';

function Body() {
  const qc = useQueryClient();
  const q = useGetNotificationSummary({ query: { queryKey: getGetNotificationSummaryQueryKey(), refetchInterval: 30000, refetchOnWindowFocus: true, retry: false }, request: FETCH_CREDS });
  const s = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetNotificationSummaryQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetNotificationLogQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetReminderJobStatusQueryKey() });
  };
  return (
    <>
      <p className="alliance-label">Admin</p>
      <h1 className="alliance-display">Email notifications</h1>
      <p className="mt-1 max-w-xl text-sm">Monthly email volume, the provider connection, and every message the portal has sent or logged.</p>
      {q.isLoading && <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>}
      {q.isError && <div className="mt-4"><Notice>{readError(q.error, SOMETHING_WENT_WRONG).message}</Notice><Button type="button" onClick={() => { void q.refetch(); }} data-testid="button-retry-summary">Try again</Button></div>}
      {s && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <UsageCard key={s.monthlyLimit} s={s} />
            <ProviderCard s={s} onDone={refresh} />
          </div>
          <Card className="p-4"><h2 className="alliance-display">Last 6 months by type</h2><p className="mb-2 text-xs text-navy-soft">The current month is still in progress.</p><UsageChart s={s} /></Card>
        </div>
      )}
      <div className="mt-6"><LogSection /></div>
    </>
  );
}

export function AdminNotifications() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Email notifications | Community Care Team Volunteer Portal';
    const descriptions = [
      ['name', 'description', 'Monitor monthly email use, delivery status and notification history for the Community Care Team Volunteer Portal.'],
      ['property', 'og:title', document.title],
      ['property', 'og:description', 'Staff email monitoring and safe notification retries.'],
    ];
    const changes = descriptions.map(([attribute, value, content]) => {
      const existing = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`);
      const tag = existing ?? document.createElement('meta');
      const old = tag.content;
      tag.setAttribute(attribute!, value!); tag.content = content!;
      if (!existing) document.head.appendChild(tag);
      return () => { if (existing) tag.content = old; else tag.remove(); };
    });
    return () => { document.title = previousTitle; changes.forEach(restore => restore()); };
  }, []);
  return <RequireAdmin>{() => <AppLayout role="admin"><Body /></AppLayout>}</RequireAdmin>;
}
