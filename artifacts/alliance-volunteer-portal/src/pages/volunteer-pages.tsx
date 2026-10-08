import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText } from 'lucide-react';
import {
  getGetVolunteerDashboardQueryKey, getGetVolunteerMessagesQueryKey, getGetVolunteerResourcesQueryKey,
  useGetVolunteerMessages, useGetVolunteerResources, useReadVolunteerMessage,
  type VolunteerMessage,
} from '@workspace/api-client-react';
import { EmptyState } from '@/components/brand-system';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Notice } from '@/auth/auth-ui';
import { ErrorBlock, LoadingBlock, VolunteerPage, volunteerRoute } from '@/components/volunteer-ui';
import { safeHttps, shortDateTime } from '@/lib/pacific';

export { ShiftsPage as Shifts } from './shifts-page';

function MessagesBody() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useGetVolunteerMessages({ query: { queryKey: getGetVolunteerMessagesQueryKey(), refetchOnWindowFocus: 'always' }, request: FETCH_CREDS });
  const read = useReadVolunteerMessage({ request: auth.request });
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function open(m: VolunteerMessage) {
    setOpenId(o => (o === m.recipientId ? null : m.recipientId));
    if (m.readAt) return;
    setErr(null);
    try {
      await read.mutateAsync({ recipientId: m.recipientId });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetVolunteerMessagesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() }),
      ]);
    } catch (e) { setErr(readError(e, "We couldn't mark that as read.").message); }
  }
  return (
    <VolunteerPage kicker="Messages" title="Messages from the Alliance">
      {err && <Notice>{err}</Notice>}
      {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorBlock what="your messages" onRetry={() => { void q.refetch(); }} /> : q.data.length === 0 ? (
        <EmptyState title="No messages yet" description="Notes from the Alliance team will land here." />
      ) : (
        <ul className="grid gap-2">
          {q.data.map(m => (
            <li key={m.recipientId} className="rounded-xl bg-white shadow-sm" data-testid={`message-${m.recipientId}`}>
              <button type="button" onClick={() => { void open(m); }} aria-expanded={openId === m.recipientId}
                className="flex min-h-14 w-full items-start gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-teal">
                <span className={`mt-2 size-2.5 shrink-0 rounded-full ${m.readAt ? 'bg-transparent' : 'bg-teal'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={`block ${m.readAt ? 'font-semibold' : 'font-bold'}`}>{m.subject}{!m.readAt && <span className="sr-only"> (unread)</span>}</span>
                  <span className="block text-xs text-navy-soft">{shortDateTime(m.sentAt)}</span>
                </span>
              </button>
              {openId === m.recipientId && <div className="whitespace-pre-wrap break-words border-t border-gray px-4 py-4 pl-9" data-testid={`text-message-body-${m.recipientId}`}>{m.body}</div>}
            </li>
          ))}
        </ul>
      )}
    </VolunteerPage>
  );
}
export const Messages = volunteerRoute(() => <MessagesBody />);

const typeName = { article: 'Article', document: 'Document', link: 'Link' } as const;

function ResourcesBody() {
  const q = useGetVolunteerResources({ query: { queryKey: getGetVolunteerResourcesQueryKey() }, request: FETCH_CREDS });
  const groups = new Map<string, NonNullable<typeof q.data>>();
  for (const r of q.data ?? []) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  return (
    <VolunteerPage kicker="Resources" title="Guides and documents">
      {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorBlock what="resources" onRetry={() => { void q.refetch(); }} /> : q.data.length === 0 ? (
        <EmptyState title="No resources yet" description="Guides, documents and links from the Alliance will be collected here." />
      ) : [...groups].map(([cat, items]) => (
        <section key={cat} aria-label={cat}>
          <h2 className="alliance-section-kicker mb-3">{cat}</h2>
          <ul className="grid gap-3">
            {items.map(r => {
              const href = safeHttps(r.href);
              return (
                <li key={r.id} className="rounded-xl bg-white p-5 shadow-sm" data-testid={`resource-${r.id}`}>
                  <p className="flex items-center gap-2 text-xs font-bold uppercase text-teal-text"><FileText size={14} aria-hidden="true" />{typeName[r.type]}</p>
                  <h3 className="mt-1 text-lg font-bold">{r.title}</h3>
                  {r.summary && <p className="mt-1 text-sm">{r.summary}</p>}
                  {r.type === 'article' && r.body && (
                    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 font-bold text-teal-text">Read article</summary>
                      <div className="whitespace-pre-wrap break-words" data-testid={`text-resource-body-${r.id}`}>{r.body}</div></details>
                  )}
                  {r.type !== 'article' && (href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="alliance-button alliance-button-secondary mt-3" data-testid={`link-resource-${r.id}`}>
                      {r.type === 'link' ? 'Open link' : 'Open document'}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : <p className="mt-3 text-sm text-navy-soft">This file isn't available to open yet. Please check back or contact the Alliance.</p>)}
                  {r.type === 'article' && !r.body && <p className="mt-3 text-sm text-navy-soft">This article has no readable content yet.</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </VolunteerPage>
  );
}
export const Resources = volunteerRoute(() => <ResourcesBody />);
