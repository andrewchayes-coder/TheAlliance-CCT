import { ContactLink } from '@/components/shift-cards';
import { useState } from 'react';
import { getGetAdminMessageQueryKey, getListAdminMessagesQueryKey, useGetAdminMessage, useListAdminMessages, type AdminMessage } from '@workspace/api-client-react';
import { Button, EmptyState, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS } from '@/auth/auth-context';
import { shortDateTime } from '@/lib/pacific';
import { MarkdownView } from './markdown-view';

const AUD: Record<string, string> = { active: 'All active', all: 'Everyone', selected: 'Chosen volunteers', single: 'One volunteer' };
export const POLL = 60_000;

export function useAdminMessages(userId?: string) {
  const params = userId ? { userId } : undefined;
  return useListAdminMessages(params, { query: { queryKey: getListAdminMessagesQueryKey(params), staleTime: FRESH_MS, refetchInterval: POLL, refetchOnWindowFocus: 'always', retry: false }, request: FETCH_CREDS });
}

function Receipts({ id }: { id: string }) {
  const q = useGetAdminMessage(id, { query: { queryKey: getGetAdminMessageQueryKey(id), staleTime: FRESH_MS, refetchInterval: POLL, refetchOnWindowFocus: 'always', retry: false }, request: FETCH_CREDS });
  if (q.isPending) return <div className="space-y-2" role="status"><span className="sr-only">Loading</span><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  if (q.isError || !q.data) return <div><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button type="button" onClick={() => { void q.refetch(); }}>Try again</Button></div>;
  return (
    <ul className="max-h-80 divide-y divide-gray overflow-y-auto text-sm" aria-label="Read receipts" data-testid={`list-receipts-${id}`}>
      {q.data.recipients.map(r => (
        <li key={r.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="min-w-0"><span className="font-bold">{r.firstName} {r.lastName}</span> <span className="break-all text-xs text-navy-soft">{r.email}</span></span>
          {r.readAt ? <StatusBadge status="good">Read {shortDateTime(r.readAt)}</StatusBadge> : <StatusBadge status="neutral">Unread</StatusBadge>}
        </li>
      ))}
    </ul>
  );
}

export function MessageHistory({ userId, receipts = false, step = 50 }: { userId?: string; receipts?: boolean; step?: number }) {
  const [shown, setShown] = useState(step);
  const q = useAdminMessages(userId);
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <div className="mt-3 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (q.isError && !q.data) return <div className="mt-3"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button type="button" onClick={() => { void q.refetch(); }}>Try again</Button></div>;
  const rows: AdminMessage[] = q.data ?? [];
  if (rows.length === 0) return <div className="mt-3"><EmptyState title="No messages yet" description={userId ? 'Nothing has been sent to this volunteer.' : 'Messages you send will be listed here with read receipts.'} /></div>;
  return (
    <div>
      {q.isError && <div className="mt-3"><Notice kind="info">Couldn't refresh. Showing the last loaded list.</Notice></div>}
      <ul className="mt-3 grid gap-2" data-testid="list-messages">
        {rows.slice(0, shown).map(m => (
          <li key={m.id} className="rounded-xl border border-gray bg-white" data-testid={`message-${m.id}`}>
            <button type="button" aria-expanded={open === m.id} onClick={() => setOpen(o => o === m.id ? null : m.id)}
              className="flex min-h-14 w-full flex-col items-start gap-1 rounded-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-blue">
              <span className="font-bold">{m.subject}</span>
              <span className="text-xs text-navy-soft">{shortDateTime(m.sentAt)} · {AUD[m.audience] ?? m.audience} · {m.sentByEmail ? 'Portal and email' : 'Portal only'}</span>
              <span className="flex flex-wrap gap-2 text-xs font-bold">
                {userId
                  ? (m.readAt ? <StatusBadge status="good">Read {shortDateTime(m.readAt)}</StatusBadge> : <StatusBadge status="neutral">Not read yet</StatusBadge>)
                  : <StatusBadge status={m.readCount >= m.recipientCount && m.recipientCount > 0 ? 'good' : 'neutral'}>{m.readCount} of {m.recipientCount} read</StatusBadge>}
              </span>
            </button>
            {open === m.id && (
              <div className="border-t border-gray px-4 py-4">
                <MarkdownView body={m.body} testId={`text-message-body-${m.id}`} />
                {receipts && <div className="mt-4"><h3 className="alliance-label mb-2">Recipients</h3><Receipts id={m.id} /></div>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-navy-soft">
        <span data-testid="text-history-count">Showing {Math.min(shown, rows.length)} of {rows.length}. Refreshes every minute.</span>
        {shown < rows.length && <Button type="button" variant="secondary" onClick={() => setShown(s => s + step)} data-testid="button-show-more">Show more</Button>}
      </div>
    </div>
  );
}
