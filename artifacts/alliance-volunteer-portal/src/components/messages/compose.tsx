import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getFindMessageVolunteersQueryKey, useFindMessageVolunteers, usePreviewAdminMessage, useSendAdminMessage,
  type MessageDraftInput, type MessageSendInput, type MessagePreview, type MessageSendResult, type MessageVolunteer,
} from '@workspace/api-client-react';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { MD_HELP } from './markdown-view';
import { MAX_RECIPIENTS, RecipientPicker } from './recipient-picker';
import { PreviewPanel } from './preview-panel';

type Audience = MessageDraftInput['audience'];
const AUD: [Audience, string, string][] = [
  ['active', 'All active volunteers', 'Everyone with Active status right now.'],
  ['all', 'Everyone, any status', 'Applicants, trainees, active and inactive.'],
  ['selected', 'Chosen volunteers', 'Pick one or more people.'],
  ['single', 'One volunteer', 'Exactly one person.'],
];
const SUBJECT_MAX = 200, BODY_MAX = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Compose({ initialIds, initialSingle, onSent }: { initialIds: string[]; initialSingle: boolean; onSent: () => void }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const seed = useMemo(() => Array.from(new Set(initialIds.map(i => UUID.test(i) ? i.toLowerCase() : i))), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [audience, setAudience] = useState<Audience>(seed.length === 0 ? 'active' : seed.length === 1 && initialSingle ? 'single' : 'selected');
  const [ids, setIds] = useState<string[]>(seed);
  const [names, setNames] = useState<Map<string, MessageVolunteer>>(new Map());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [byEmail, setByEmail] = useState(true);
  const [pv, setPv] = useState<{ key: string; data: MessagePreview } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MessageSendResult | null>(null);
  const rid = useRef<{ key: string; id: string } | null>(null);
  const sending = useRef(false);
  const [unsure, setUnsure] = useState<{ payload: MessageSendInput; subject: string; count: number } | null>(null);

  const hyd = useFindMessageVolunteers({ ids: seed.join(',') }, {
    query: { queryKey: getFindMessageVolunteersQueryKey({ ids: seed.join(',') }), enabled: seed.length > 0 && seed.length <= MAX_RECIPIENTS && seed.every(i => UUID.test(i)), staleTime: 60_000, retry: false }, request: FETCH_CREDS,
  });
  useEffect(() => { if (hyd.data) remember(hyd.data); }, [hyd.data]);
  const remember = (vs: MessageVolunteer[]) => setNames(m => { const n = new Map(m); vs.forEach(v => n.set(v.userId, v)); return n; });

  const preview = usePreviewAdminMessage({ request: auth.request });
  const send = useSendAdminMessage({ request: auth.request });
  const busy = preview.isPending || send.isPending;

  const useIds = audience === 'selected' || audience === 'single';
  const draft: MessageDraftInput = { audience, userIds: useIds ? ids : [], subject, body, sendByEmail: byEmail };
  const key = JSON.stringify(draft);
  const valid = pv && pv.key === key ? pv.data : null;
  const problems: string[] = [];
  if (!subject.trim()) problems.push('Add a subject.');
  if (!body.trim()) problems.push('Write a message.');
  if (useIds && ids.length > MAX_RECIPIENTS) problems.push(`Choose up to ${MAX_RECIPIENTS} people per selected message. Remove some selections or choose an all-volunteer audience.`);
  if (useIds && ids.some(i => !UUID.test(i))) problems.push('Some preselected references are invalid. Remove them and choose volunteers again.');
  if (audience === 'selected' && ids.length < 1) problems.push('Choose at least one volunteer.');
  if (audience === 'single' && ids.length !== 1) problems.push(ids.length === 0 ? 'Choose one volunteer.' : 'One volunteer only. Remove the others or switch to Chosen volunteers.');
  const touch = () => { setErr(null); setResult(null); };

  function pickAudience(a: Audience) { touch(); setAudience(a); }
  function add(vs: MessageVolunteer[]) {
    touch(); remember(vs);
    setIds(cur => audience === 'single' ? [vs[0]!.userId] : Array.from(new Set([...cur, ...vs.map(v => v.userId)])).slice(0, MAX_RECIPIENTS));
  }
  async function runPreview() {
    setErr(null); setResult(null);
    const k = key;
    try { const data = await preview.mutateAsync({ data: draft }); setPv({ key: k, data }); }
    catch (e) { setPv(null); setErr(readError(e, "We couldn't build the preview. Check your connection and try again.").message); }
  }
  async function exec(payload: MessageSendInput, subj: string, count: number, retry: boolean) {
    if (sending.current) return;
    sending.current = true; setErr(null);
    try {
      const res = await send.mutateAsync({ data: payload });
      const same = key === JSON.stringify({ audience: payload.audience, userIds: payload.userIds, subject: payload.subject, body: payload.body, sendByEmail: payload.sendByEmail });
      if (same) { rid.current = null; setPv(null); }
      setUnsure(null); setResult(res);
      if (same) { setSubject(''); setBody(''); setIds([]); setAudience('active'); setByEmail(true); }
      await qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/api/admin/messages') });
      onSent();
    } catch (e) {
      const f = readError(e, '');
      if (f.status === undefined || f.status >= 500) { setUnsure({ payload, subject: subj, count }); setErr("We couldn't confirm whether that was sent."); }
      else {
        setUnsure(null); rid.current = null;
        if (f.status === 409) { setPv(null); setErr('The recipient list changed since your preview. Preview again to see the new count, then send.'); }
        else setErr(f.message || "We couldn't send that message.");
      }
    } finally { sending.current = false; }
  }
  function runSend() {
    if (unsure) { setErr('Resolve the earlier unconfirmed send first: retry that exact send, or check Sent and discard its pending reference. Your edited draft is kept.'); return; }
    if (!valid || valid.recipientCount === 0) return;
    const k = `${key}|${valid.previewHash}`;
    if (!rid.current || rid.current.key !== k) rid.current = { key: k, id: crypto.randomUUID() };
    void exec({ ...draft, requestId: rid.current.id, previewHash: valid.previewHash }, subject, valid.recipientCount, false);
  }

  return (
    <div data-testid="panel-compose">
      {unsure && (
        <div className="mb-5" role="alert" data-testid="panel-unsure">
          <Notice>Your earlier send, "{unsure.payload.subject}" to {unsure.count} volunteer{unsure.count === 1 ? '' : 's'}, is unconfirmed. It may or may not have gone out. Retrying sends that exact saved draft with the same request id, so nobody gets it twice. If you edit and send something new, that is a separate message and the earlier one stays uncertain.</Notice>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => { void exec(unsure.payload, unsure.subject, unsure.count, true); }} data-testid="button-retry-send">Retry that exact send</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setUnsure(null); rid.current = null; }} data-testid="button-abort-send">I checked the Sent tab. Discard it</Button>
          </div>
        </div>
      )}
      {result && (
        <div className="mb-5" role="status" data-testid="result-send">
          <Notice kind={result.failed > 0 ? 'info' : 'success'}>
            {result.reused ? 'This message had already been sent. ' : 'Message sent. '}Reached {result.recipientCount} in the portal. Email: {result.sent} sent, {result.logged} logged, {result.failed} failed, {result.skipped} skipped.
          </Notice>
        </div>
      )}
      <fieldset className="alliance-card" disabled={busy}>
        <legend className="alliance-display px-1 text-[15px]">Who gets it</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Audience">
          {AUD.map(([v, l, d]) => (
            <label key={v} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 ${audience === v ? 'border-navy bg-gray' : 'border-gray'}`}>
              <input type="radio" name="audience" className="mt-1 size-5" checked={audience === v} onChange={() => pickAudience(v)} data-testid={`radio-audience-${v}`} />
              <span><span className="block font-bold">{l}</span><span className="block text-sm text-navy-soft">{d}</span></span>
            </label>
          ))}
        </div>
        {useIds && <RecipientPicker audience={audience as 'selected' | 'single'} ids={ids} names={names} disabled={busy}
          onAdd={add} onRemove={id => { touch(); setIds(c => c.filter(x => x !== id)); }} onClear={() => { touch(); setIds([]); }} />}
        {seed.length > 0 && hyd.isError && <div className="mt-3"><Notice>We couldn't load the names for your preselected volunteers. They are still selected.</Notice></div>}
      </fieldset>

      <fieldset className="alliance-card mt-5" disabled={busy}>
        <legend className="alliance-display px-1 text-[15px]">Message</legend>
        <label className="mt-2 block text-sm font-bold">Subject
          <input className="alliance-input mt-1 font-normal" maxLength={SUBJECT_MAX} value={subject} onChange={e => { touch(); setSubject(e.target.value); }} data-testid="input-subject" />
        </label>
        <p className="mt-1 text-right text-xs text-navy-soft tabular-nums">{subject.length}/{SUBJECT_MAX}</p>
        <label className="mt-2 block text-sm font-bold">Body
          <textarea className="alliance-input mt-1 min-h-48 font-normal" maxLength={BODY_MAX} value={body} onChange={e => { touch(); setBody(e.target.value); }} aria-describedby="md-help" data-testid="input-body" />
        </label>
        <p className="text-right text-xs text-navy-soft tabular-nums">{body.length}/{BODY_MAX}</p>
        <p id="md-help" className="mt-1 text-xs text-navy-soft">{MD_HELP}</p>
        <label className="mt-4 flex min-h-11 items-center gap-3 font-bold">
          <input type="checkbox" className="size-5" checked={byEmail} onChange={e => { touch(); setByEmail(e.target.checked); }} data-testid="checkbox-email" />
          Also send by email
        </label>
      </fieldset>

      {problems.length > 0 && <ul className="mt-4 text-sm" data-testid="list-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      {err && <div className="mt-4" role="alert" data-testid="text-send-error"><Notice>{err}</Notice></div>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant={valid ? 'secondary' : 'default'} disabled={busy || problems.length > 0} onClick={() => { void runPreview(); }} data-testid="button-preview">
          {preview.isPending ? 'Building preview' : valid ? 'Refresh preview' : 'Preview recipients and message'}</Button>
        {send.isPending && <span role="status" className="text-sm font-bold">Sending. Please wait.</span>}
        {!valid && problems.length === 0 && !busy && <span className="text-sm text-navy-soft">Preview is required before sending. Any edit clears it.</span>}
      </div>
      {valid && <PreviewPanel preview={valid} subject={subject} body={body} byEmail={byEmail} busy={busy} onSend={runSend} />}
    </div>
  );
}
