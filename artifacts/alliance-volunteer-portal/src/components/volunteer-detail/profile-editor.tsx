import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAdminOverviewQueryKey, getGetAdminVolunteerQueryKey, getListVolunteerRosterQueryKey, useUpdateVolunteerTracking,
  type AdminVolunteerDetail, type VolunteerTrackingUpdate,
} from '@workspace/api-client-react';
import { calendarDateSchema, formatPhone, pacificToday, phoneDigits, states } from '@workspace/shared/profileFields';
import { appConfig } from '@workspace/shared/appConfig';
import { Button } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { calDate, dateInput } from './format';

type Err = { msg: string; conflict: boolean };

function useProfileSave(userId: string, detail: AdminVolunteerDetail) {
  const { request } = useAuth();
  const qc = useQueryClient();
  const m = useUpdateVolunteerTracking({ request });
  const base = useRef('');
  const [err, setErr] = useState<Err | null>(null);
  const [saved, setSaved] = useState(false);
  const begin = () => { if (!base.current) base.current = detail.entry.profile.updatedAt; };
  const save = (fields: Partial<VolunteerTrackingUpdate>, done: () => void) => {
    setErr(null);
    const data: VolunteerTrackingUpdate = { expectedUpdatedAt: base.current || detail.entry.profile.updatedAt, ...fields };
    m.mutate({ userId, data }, {
      onSuccess: r => {
        qc.setQueryData(getGetAdminVolunteerQueryKey(userId), r);
        void qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) });
        void qc.invalidateQueries({ queryKey: getListVolunteerRosterQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
        base.current = ''; setSaved(true); done();
      },
      onError: e => {
        const f = readError(e);
        if (f.status === 409) void qc.invalidateQueries({ queryKey: getGetAdminVolunteerQueryKey(userId) });
        setErr(f.status === 409
          ? { conflict: true, msg: 'Someone else updated this volunteer while you were editing. Your edits are still here and were not saved. Review the latest values, then save again.' }
          : { conflict: false, msg: f.message });
      },
    });
  };
  const rebase = () => { base.current = ''; setErr(null); };
  return { m, err, setErr, saved, setSaved, begin, save, rebase, reset: () => { base.current = ''; setErr(null); } };
}

export function StartDateEditor({ userId, detail }: { userId: string; detail: AdminVolunteerDetail }) {
  const s = useProfileSave(userId, detail);
  const cur = dateInput(detail.entry.profile.startDate);
  const [val, setVal] = useState<string | null>(null);
  const submit = () => {
    const v = (val ?? '').trim();
    if (v && !calendarDateSchema.safeParse(v).success) { s.setErr({ conflict: false, msg: 'Enter a valid start date.' }); return; }
    if (v === cur) { setVal(null); s.reset(); return; }
    s.save({ startDate: v || null }, () => setVal(null));
  };
  return (
    <div data-testid="start-date-editor">
      <dt className="alliance-label">Start date</dt>
      <dd>
        {val === null ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span data-testid="text-start-date">{cur ? calDate(cur) : 'Not set'}</span>
            <button type="button" className="min-h-11 px-1 text-sm font-bold text-blue underline underline-offset-4" data-testid="button-edit-start-date"
              onClick={() => { s.begin(); s.setSaved(false); setVal(cur); }}>Edit</button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="Start date" className="alliance-input w-auto" value={val} onChange={e => setVal(e.target.value)} data-testid="input-start-date" />
            <Button type="button" onClick={submit} disabled={s.m.isPending} data-testid="button-save-start-date">{s.m.isPending ? 'Saving…' : 'Save'}</Button>
            <Button type="button" variant="secondary" onClick={() => { setVal(null); s.reset(); }} disabled={s.m.isPending}>Cancel</Button>
          </span>
        )}
      </dd>
      {s.err && <div className="mt-2"><Notice>{s.err.msg}</Notice></div>}
      {s.saved && val === null && <p className="mt-1 text-xs font-bold" role="status">Saved.</p>}
    </div>
  );
}

type D = { dob: string; addr: string; city: string; state: string; zip: string; en: string; er: string; ep: string; county: string };
const fromServer = (d: AdminVolunteerDetail): D => {
  const p = d.entry.profile;
  return { dob: dateInput(p.dateOfBirth), addr: p.addressLine1 ?? '', city: p.city ?? '', state: p.state ?? '', zip: p.zip ?? '',
    en: p.emergencyContactName ?? '', er: p.emergencyContactRelationship ?? '', ep: p.emergencyContactPhone ?? '', county: p.county || appConfig.defaultCounty };
};
const nz = (v: string) => v.trim() || null;

export function ProfileCard({ userId, detail, blockedReason }: { userId: string; detail: AdminVolunteerDetail; blockedReason: string | null }) {
  const s = useProfileSave(userId, detail);
  const [draft, setDraft] = useState<D | null>(null);
  const srv = fromServer(detail);
  const cur = draft ?? srv;
  const set = (k: keyof D, v: string) => { if (!draft) s.begin(); s.setSaved(false); setDraft({ ...cur, [k]: v }); };
  const counties = Array.from(new Set([...(cur.county ? [cur.county] : []), ...appConfig.counties]));

  const submit = () => {
    if (!draft) return;
    const bad = (msg: string) => s.setErr({ conflict: false, msg });
    if (cur.dob && (!calendarDateSchema.safeParse(cur.dob).success || cur.dob >= pacificToday())) return bad('Enter a valid date of birth in the past.');
    if (cur.state && !(states as readonly string[]).includes(cur.state)) return bad('Choose a valid US state.');
    if (!cur.county.trim()) return bad('County is required.');
    if (cur.zip.trim() && !/^\d{5}(-\d{4})?$/.test(cur.zip.trim())) return bad('Enter a valid ZIP code (12345 or 12345-6789).');
    if (cur.ep.trim() && phoneDigits(cur.ep).length !== 10) return bad('Enter a 10-digit emergency contact phone number.');
    const f: Partial<VolunteerTrackingUpdate> = {};
    if (cur.dob !== srv.dob) f.dateOfBirth = cur.dob || null;
    if (cur.addr.trim() !== srv.addr) f.addressLine1 = nz(cur.addr);
    if (cur.city.trim() !== srv.city) f.city = nz(cur.city);
    if (cur.state !== srv.state) f.state = nz(cur.state);
    if (cur.zip.trim() !== srv.zip) f.zip = nz(cur.zip);
    if (cur.en.trim() !== srv.en) f.emergencyContactName = nz(cur.en);
    if (cur.er.trim() !== srv.er) f.emergencyContactRelationship = nz(cur.er);
    if (cur.ep.trim() !== srv.ep) f.emergencyContactPhone = cur.ep.trim() ? formatPhone(cur.ep) || cur.ep.trim() : null;
    if (cur.county.trim() !== srv.county) f.county = cur.county.trim();
    if (Object.keys(f).length === 0) { setDraft(null); s.reset(); return; }
    s.save(f, () => setDraft(null));
  };
  const inp = 'alliance-input mt-1 font-normal';
  const tel = cur.ep.trim() && phoneDigits(cur.ep).length >= 10 ? cur.ep.trim() : null;
  return (
    <section className="alliance-card mt-6" aria-labelledby="v-profile" data-testid="card-profile">
      <h2 id="v-profile" className="alliance-display">Profile</h2>
      <p className="mt-1 text-sm text-navy-soft">Visible to Alliance staff only.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label htmlFor={`profile-${userId}-dob`} className="block text-sm font-bold">Date of birth
          <input id={`profile-${userId}-dob`} type="date" className={inp} value={cur.dob} onChange={e => set('dob', e.target.value)} data-testid="input-dob" /></label>
        <label htmlFor={`profile-${userId}-county`} className="block text-sm font-bold">County <span className="font-normal text-navy-soft">(admin only)</span>
          <select id={`profile-${userId}-county`} className={inp} value={cur.county} onChange={e => set('county', e.target.value)} data-testid="select-county">
            {counties.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <label htmlFor={`profile-${userId}-address`} className="block text-sm font-bold sm:col-span-2">Address
          <input id={`profile-${userId}-address`} className={inp} maxLength={300} autoComplete="off" value={cur.addr} onChange={e => set('addr', e.target.value)} data-testid="input-address" /></label>
        <div className="grid grid-cols-[1fr_5rem_7rem] gap-3 sm:col-span-2">
          <label htmlFor={`profile-${userId}-city`} className="block min-w-0 text-sm font-bold">City
            <input id={`profile-${userId}-city`} className={inp} maxLength={100} value={cur.city} onChange={e => set('city', e.target.value)} data-testid="input-city" /></label>
          <label htmlFor={`profile-${userId}-state`} className="block text-sm font-bold">State
            <select id={`profile-${userId}-state`} className={inp} value={cur.state} onChange={e => set('state', e.target.value)} data-testid="select-state">
              <option value="">--</option>{states.map(x => <option key={x} value={x}>{x}</option>)}</select></label>
          <label htmlFor={`profile-${userId}-zip`} className="block text-sm font-bold">ZIP
            <input id={`profile-${userId}-zip`} className={inp} maxLength={10} inputMode="numeric" value={cur.zip} onChange={e => set('zip', e.target.value)} data-testid="input-zip" /></label>
        </div>
        <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="mb-1 font-bold">Emergency contact</legend>
          <label htmlFor={`profile-${userId}-ec-name`} className="block text-sm font-bold">Name
            <input id={`profile-${userId}-ec-name`} className={inp} maxLength={200} value={cur.en} onChange={e => set('en', e.target.value)} data-testid="input-ec-name" /></label>
          <label htmlFor={`profile-${userId}-ec-relationship`} className="block text-sm font-bold">Relationship
            <input id={`profile-${userId}-ec-relationship`} className={inp} maxLength={100} value={cur.er} onChange={e => set('er', e.target.value)} data-testid="input-ec-relationship" /></label>
          <label htmlFor={`profile-${userId}-ec-phone`} className="block text-sm font-bold">Phone
            <input id={`profile-${userId}-ec-phone`} type="tel" className={inp} maxLength={30} value={formatPhone(cur.ep) || cur.ep} onChange={e => set('ep', e.target.value)} data-testid="input-ec-phone" /></label>
          {tel && <a href={`tel:${tel}`} className="text-sm font-bold text-blue underline underline-offset-4 sm:col-span-3" data-testid="link-ec-phone">Call {cur.en.trim() || 'emergency contact'} at {formatPhone(tel) || tel}</a>}
        </fieldset>
      </div>
      {s.err && <div className="mt-3"><Notice>{s.err.msg}</Notice>{s.err.conflict && <Button type="button" variant="secondary" onClick={s.rebase} data-testid="button-rebase-profile">Save on top of latest version</Button>}</div>}
      {s.saved && !draft && <p className="mt-3 text-sm font-bold" role="status">Saved.</p>}
      {draft && <p className="mt-3 text-sm text-navy-soft">Unsaved changes.</p>}
      {draft && blockedReason && <p className="mt-2 text-sm font-bold" role="status">{blockedReason}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={submit} disabled={!draft || s.m.isPending || !!blockedReason} data-testid="button-save-profile">{s.m.isPending ? 'Saving…' : 'Save profile'}</Button>
        {draft && <Button type="button" variant="secondary" onClick={() => { setDraft(null); s.reset(); }} disabled={s.m.isPending} data-testid="button-discard-profile">Discard edits</Button>}
      </div>
    </section>
  );
}
