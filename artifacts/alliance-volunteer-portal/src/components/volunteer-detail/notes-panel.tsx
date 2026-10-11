import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAdminVolunteerQueryKey, useUpdateVolunteerNotes } from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';

type S = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

export function NotesPanel({ userId, serverNotes, onPending }: { userId: string; serverNotes: string | null; onPending: (p: boolean) => void }) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const m = useUpdateVolunteerNotes({ request });
  const mutateRef = useRef(m.mutateAsync); mutateRef.current = m.mutateAsync;
  const [draft, setDraft] = useState(serverNotes ?? '');
  const [state, setState] = useState<S>('idle');
  const draftRef = useRef(draft);
  const serverRef = useRef(serverNotes);
  const ackRef = useRef(serverNotes ?? '');
  const stateRef = useRef<S>('idle');
  const inflight = useRef(false);
  const setS = (s: S) => { stateRef.current = s; setState(s); };
  const key = getGetAdminVolunteerQueryKey(userId);

  const flush = async () => {
    if (inflight.current || stateRef.current === 'conflict' || stateRef.current === 'failed') return;
    while (draftRef.current !== ackRef.current) {
      const sent = draftRef.current;
      inflight.current = true; setS('saving');
      try {
        const r = await mutateRef.current({ userId, data: { adminNotes: sent.trim() ? sent : null, expectedAdminNotes: serverRef.current } });
        serverRef.current = r.adminNotes; ackRef.current = sent;
        qc.setQueryData(key, r);
      } catch (e) {
        inflight.current = false;
        if (readError(e).status === 409) { setS('conflict'); void qc.invalidateQueries({ queryKey: key }); } else setS('failed');
        return;
      }
      inflight.current = false;
    }
    setS('saved');
  };
  const flushRef = useRef(flush); flushRef.current = flush;

  const dirty = draft !== ackRef.current;
  const pending = dirty || state === 'saving' || state === 'failed' || state === 'conflict';
  const pendingRef = useRef(onPending); pendingRef.current = onPending;
  useEffect(() => { pendingRef.current(pending); }, [pending]);
  useEffect(() => () => { pendingRef.current(false); void flushRef.current(); }, []);

  useEffect(() => {
    if (draft === ackRef.current || state === 'conflict' || state === 'failed') return;
    const t = setTimeout(() => { void flushRef.current(); }, 800);
    return () => clearTimeout(t);
  }, [draft, state]);

  // Adopt fresh server notes only when there is nothing unsaved.
  useEffect(() => {
    const fresh = serverNotes;
    if (inflight.current || draftRef.current !== ackRef.current || stateRef.current === 'conflict' || fresh === serverRef.current) return;
    serverRef.current = fresh; ackRef.current = fresh ?? ''; draftRef.current = fresh ?? ''; setDraft(fresh ?? '');
  }, [serverNotes]);

  const edit = (v: string) => { draftRef.current = v; setDraft(v); if (stateRef.current === 'failed' || stateRef.current === 'saved') setS('idle'); };
  const retry = () => { setS('idle'); void flushRef.current(); };
  const useServer = () => {
    const f = serverNotes ?? '';
    serverRef.current = serverNotes; ackRef.current = f; draftRef.current = f; setDraft(f); setS('idle');
  };
  const reapply = () => { serverRef.current = serverNotes; setS('idle'); void flushRef.current(); };

  return (
    <section className="alliance-card mt-6" aria-labelledby="v-notes">
      <h2 id="v-notes" className="alliance-display">Admin notes</h2>
      <label htmlFor="admin-notes" className="mt-3 block text-sm font-bold">Visible to Alliance staff only.</label>
      <textarea id="admin-notes" className="alliance-input mt-1 min-h-32" maxLength={20000} value={draft} data-testid="input-admin-notes"
        onChange={e => edit(e.target.value)} onBlur={() => { void flushRef.current(); }} />
      <div className="mt-2 text-sm" role="status" aria-live="polite" data-testid="text-notes-state">
        {state === 'saving' && 'Saving…'}
        {state === 'saved' && !dirty && 'Saved'}
        {dirty && state !== 'saving' && state !== 'failed' && state !== 'conflict' && 'Unsaved changes'}
      </div>
      {state === 'failed' && (
        <div className="mt-2"><Notice>We couldn't save your notes. Your draft is still here.</Notice>
          <Button type="button" variant="secondary" onClick={retry} data-testid="button-notes-retry">Retry saving</Button></div>
      )}
      {state === 'conflict' && (
        <div className="mt-2" data-testid="notes-conflict">
          <Notice>Someone else changed these notes. Your draft is kept and has not been saved. Review the latest notes below, then choose.</Notice>
          <p className="mt-2 text-sm font-bold">Latest saved notes</p>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray p-3 text-sm" data-testid="text-latest-notes">{serverNotes || 'No notes'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={useServer} data-testid="button-notes-use-latest">Use latest notes</Button>
            <Button type="button" onClick={reapply} data-testid="button-notes-reapply">Replace with my draft</Button>
          </div>
        </div>
      )}
    </section>
  );
}
