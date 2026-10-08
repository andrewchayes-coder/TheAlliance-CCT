import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getFindMessageVolunteersQueryKey, useFindMessageVolunteers, type MessageVolunteer } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS } from '@/auth/auth-context';

export const MAX_RECIPIENTS = 500;
const nm = (v: MessageVolunteer) => `${v.firstName} ${v.lastName}`;

export function RecipientPicker({ audience, ids, names, disabled, onAdd, onRemove, onClear }: {
  audience: 'selected' | 'single'; ids: string[]; names: Map<string, MessageVolunteer>; disabled: boolean;
  onAdd: (v: MessageVolunteer[]) => void; onRemove: (id: string) => void; onClear: () => void;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const params = q ? { q } : {};
  const res = useFindMessageVolunteers(params, { query: { queryKey: getFindMessageVolunteersQueryKey(params), staleTime: 15_000, retry: false }, request: FETCH_CREDS });
  const rows = res.data ?? [];
  const single = audience === 'single';
  const picked = new Set(ids);
  const addable = rows.filter(r => !picked.has(r.userId));
  return (
    <div className="mt-4" data-testid="picker-recipients">
      <p className="text-sm font-bold" aria-live="polite" data-testid="text-picked-count">{ids.length} chosen{single ? ' (exactly one)' : ` of ${MAX_RECIPIENTS} max`}</p>
      {ids.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Chosen recipients">
          {ids.map(id => { const v = names.get(id); return (
            <li key={id} className="flex min-h-11 items-center gap-1 rounded-full bg-navy py-1 pl-4 pr-1 text-sm font-bold text-white" data-testid={`chip-recipient-${id}`}>
              <span className="max-w-[200px] truncate">{v ? nm(v) : 'Loading name'}</span>
              <button type="button" disabled={disabled} onClick={() => onRemove(id)} aria-label={`Remove ${v ? nm(v) : 'recipient'}`}
                className="flex size-9 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"><X size={16} aria-hidden="true" /></button>
            </li>); })}
          <li><button type="button" disabled={disabled} onClick={onClear} className="min-h-11 px-2 text-sm font-bold text-teal-text underline underline-offset-4" data-testid="button-clear-recipients">Clear all</button></li>
        </ul>
      ) : <p className="mt-1 text-sm text-navy-soft">No one chosen yet. Search below.</p>}
      <div className="relative mt-4">
        <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
        <input type="search" aria-label="Search volunteers by name or email" placeholder="Search any volunteer by name or email…" maxLength={200}
          className="alliance-input pl-10" value={text} onChange={e => setText(e.target.value)} data-testid="input-recipient-search" />
      </div>
      <p className="mt-1 text-xs text-navy-soft">Search covers volunteers of any status. Your chosen people stay chosen across searches. Shows up to 500 matches.</p>
      {res.isPending ? <div className="mt-3 space-y-2" role="status"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        : res.isError ? <div className="mt-3"><Notice>We couldn't search volunteers.</Notice><Button type="button" onClick={() => { void res.refetch(); }}>Try again</Button></div>
        : rows.length === 0 ? <p className="mt-3 rounded-lg bg-gray px-4 py-3 text-sm" data-testid="text-no-matches">No volunteers match that search.</p>
        : (<>
          {!single && addable.length > 0 && <Button type="button" variant="secondary" className="mt-3" disabled={disabled} onClick={() => onAdd(addable)} data-testid="button-add-all-shown">Add all {addable.length} shown</Button>}
          <ul className="mt-3 max-h-72 divide-y divide-gray overflow-y-auto rounded-lg border border-gray" aria-label="Search results">
            {rows.map(v => { const on = picked.has(v.userId); return (
              <li key={v.userId} className="flex items-center gap-3 px-3 py-2" data-testid={`result-${v.userId}`}>
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{nm(v)}</p><p className="break-all text-xs text-navy-soft">{v.email} · {v.status.replace(/_/g, ' ')}</p></div>
                <Button type="button" variant="secondary" disabled={disabled || (!on && !single && ids.length >= MAX_RECIPIENTS)} aria-pressed={on}
                  onClick={() => on ? onRemove(v.userId) : onAdd([v])} data-testid={`button-pick-${v.userId}`}>{on ? 'Remove' : single ? 'Choose' : 'Add'}</Button>
              </li>); })}
          </ul></>)}
    </div>
  );
}
