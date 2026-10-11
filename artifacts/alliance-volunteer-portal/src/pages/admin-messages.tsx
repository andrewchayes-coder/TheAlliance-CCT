import { useState } from 'react';
import { useSearch } from 'wouter';
import { AppLayout } from '@/components/brand-system';
import { RequireAdmin } from '@/auth/guards';
import { Compose } from '@/components/messages/compose';
import { MessageHistory } from '@/components/messages/sent-list';

function Body() {
  const search = useSearch();
  const [params] = useState(() => new URLSearchParams(search));
  const many = (params.get('userIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const one = params.get('userId');
  const initial = one ? [one] : many;
  const [tab, setTab] = useState<'compose' | 'sent'>('compose');
  const tabs = [['compose', 'Compose'], ['sent', 'Sent and read receipts']] as const;
  return (
    <AppLayout role="admin">
      <p className="alliance-label">Administration</p>
      <h1 className="alliance-display mt-3">Messages</h1>
      <p className="mt-2 max-w-2xl">Write to volunteers. Every message is previewed first, then lands in their portal inbox and optionally their email.</p>
      <div role="tablist" aria-label="Messages" className="mt-5 flex gap-2">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
            className={`min-h-11 rounded-full px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-blue ${tab === k ? 'bg-navy text-white' : 'bg-white shadow-sm'}`}>{l}</button>
        ))}
      </div>
      <div className="mt-5" role="tabpanel">
        <div hidden={tab !== 'compose'}><Compose initialIds={initial} initialSingle={!!one} onSent={() => undefined} /></div>
        {tab === 'sent' && <section className="alliance-card" aria-label="Sent messages"><h2 className="alliance-display">Sent</h2><MessageHistory receipts /></section>}
      </div>
    </AppLayout>
  );
}
export const AdminMessages = () => <RequireAdmin>{() => <Body />}</RequireAdmin>;
