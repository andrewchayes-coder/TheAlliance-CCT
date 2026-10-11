import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminOverviewQueryKey, getGetAdminVolunteerQueryKey, getListVolunteerRosterQueryKey, useUpdateVolunteerTracking,
  type AdminVolunteerDetail, type VolunteerTrackingUpdate,
} from '@workspace/api-client-react';
import { Button, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { BG, CERT, calDate, dateInput, daysUntil, flags } from './format';

type Draft = { cs: string; cc: string; ce: string; bs: string; bsub: string; bc: string };
const fromServer = (d: AdminVolunteerDetail): Draft => {
  const p = d.entry.profile;
  return {
    cs: p.certificationStatus, cc: dateInput(p.certificationCompletedAt), ce: dateInput(p.certificationExpiresAt),
    bs: p.backgroundCheckStatus, bsub: dateInput(p.backgroundCheckSubmittedAt), bc: dateInput(p.backgroundCheckClearedAt) };
};

export function TrackingPanel({ userId, detail, blockedReason, onDirty }: { userId: string; detail: AdminVolunteerDetail; blockedReason: string | null; onDirty: (d: boolean) => void }) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const m = useUpdateVolunteerTracking({ request });
  const [draft, setDraft] = useState<Draft | null>(null);
  const base = useRef('');
  const [err, setErr] = useState<{ msg: string; conflict: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(onDirty); dirtyRef.current = onDirty;
  useEffect(() => { dirtyRef.current(draft !== null); }, [draft]);
  useEffect(() => () => dirtyRef.current(false), []);
  const cur = draft ?? fromServer(detail);
  const set = (k: keyof Draft, v: string) => {
    if (!draft) base.current = detail.entry.profile.updatedAt;
    setDraft({ ...cur, [k]: v }); setSaved(false);
  };
  const exp = flags.cert && cur.ce ? daysUntil(cur.ce) : null;

  const save = () => {
    const p = detail.entry.profile;
    const data: VolunteerTrackingUpdate = { expectedUpdatedAt: base.current || p.updatedAt };
    if (flags.cert) {
      data.certificationStatus = cur.cs as VolunteerTrackingUpdate['certificationStatus'];
      data.certificationCompletedAt = cur.cc || null; data.certificationExpiresAt = cur.ce || null;
    }
    if (flags.bg) {
      data.backgroundCheckStatus = cur.bs as VolunteerTrackingUpdate['backgroundCheckStatus'];
      data.backgroundCheckSubmittedAt = cur.bsub || null; data.backgroundCheckClearedAt = cur.bc || null;
    }
    setErr(null);
    m.mutate({ userId, data }, {
      onSuccess: r => {
        qc.setQueryData(getGetAdminVolunteerQueryKey(userId), r);
        void qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) });
        void qc.invalidateQueries({ queryKey: getListVolunteerRosterQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        setDraft(null); setSaved(true);
      },
      onError: e => {
        const f = readError(e);
        setErr(f.status === 409
          ? { conflict: true, msg: 'This volunteer changed since you started editing. Your edits were not saved. Review the latest values, then discard your edits and try again.' }
          : { conflict: false, msg: f.message });
      },
    });
  };
  const discard = () => { setDraft(null); setErr(null); void qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) }); };

  if (!flags.cert && !flags.bg) return null;
  const sel = 'alliance-input mt-1 font-normal';
  return (
    <section className="alliance-card mt-6" aria-labelledby="v-tracking">
      <h2 id="v-tracking" className="alliance-display">Dates</h2>
      <p className="mt-1 text-sm text-navy-soft">Only Alliance staff can see these.{flags.bg ? " Track status only. Don't upload or paste background check reports here." : ''}</p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {flags.cert && (
          <fieldset className="space-y-3">
            <legend className="font-bold">Certification</legend>
            <label className="block text-sm font-bold">Status
              <select className={sel} value={cur.cs} onChange={e => set('cs', e.target.value)} data-testid="select-cert-status">
                {Object.entries(CERT).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="block text-sm font-bold">Completed on
              <input type="date" className={sel} value={cur.cc} onChange={e => set('cc', e.target.value)} data-testid="input-cert-completed" /></label>
            <label className="block text-sm font-bold">Expires on (optional)
              <input type="date" className={sel} value={cur.ce} onChange={e => set('ce', e.target.value)} data-testid="input-cert-expires" /></label>
            {exp !== null && (exp >= 0 && exp <= 30
              ? <StatusBadge status="attention">{exp === 0 ? 'Expires today' : `Expires in ${exp} ${exp === 1 ? 'day' : 'days'}`}</StatusBadge>
              : exp < 0 ? <StatusBadge status="blocked">Expired {calDate(cur.ce)}</StatusBadge> : null)}
          </fieldset>
        )}
        {flags.bg && (
          <fieldset className="space-y-3">
            <legend className="font-bold">Background check</legend>
            <label className="block text-sm font-bold">Status
              <select className={sel} value={cur.bs} onChange={e => set('bs', e.target.value)} data-testid="select-bg-status">
                {Object.entries(BG).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="block text-sm font-bold">Submitted on
              <input type="date" className={sel} value={cur.bsub} onChange={e => set('bsub', e.target.value)} data-testid="input-bg-submitted" /></label>
            <label className="block text-sm font-bold">Cleared on
              <input type="date" className={sel} value={cur.bc} onChange={e => set('bc', e.target.value)} data-testid="input-bg-cleared" /></label>
          </fieldset>
        )}
      </div>
      {err && <div className="mt-3"><Notice>{err.msg}</Notice></div>}
      {saved && !draft && <p className="mt-3 text-sm font-bold" role="status">Saved.</p>}
      {draft && <p className="mt-3 text-sm text-navy-soft">Unsaved changes. Saving updates both cards.</p>}
      {draft && blockedReason && <p className="mt-2 text-sm font-bold" role="status">{blockedReason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={!draft || m.isPending || !!blockedReason} data-testid="button-save-tracking">{m.isPending ? 'Saving…' : 'Save'}</Button>
        {draft && <Button type="button" variant="secondary" onClick={discard} disabled={m.isPending} data-testid="button-discard-tracking">Discard edits</Button>}
      </div>
    </section>
  );
}
