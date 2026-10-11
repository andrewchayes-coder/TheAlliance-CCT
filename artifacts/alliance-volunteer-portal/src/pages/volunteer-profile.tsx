import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMeQueryKey, getGetVolunteerDashboardQueryKey, useChangeVolunteerPassword, useUpdateVolunteerProfile, type Me,
} from '@workspace/api-client-react';
import { buildOnboardingAnswersSchema, onboardingContactSchema, onboardingQuestions } from '@workspace/shared/onboardingQuestions';
import { appConfig } from '@workspace/shared/appConfig';
import { Button, Card } from '@/components/brand-system';
import { Field, Notice, PasswordField } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { VolunteerPage, volunteerRoute } from '@/components/volunteer-ui';
import { QuestionField } from '@/pages/onboarding';

type Errors = Record<string, string>;
const issues = (list: { path: PropertyKey[]; message: string }[]): Errors => {
  const o: Errors = {};
  for (const i of list) { const k = String(i.path[0] ?? ''); if (k && !o[k]) o[k] = i.message; }
  return o;
};
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const date = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat('en-US', { timeZone: appConfig.timezone, dateStyle: 'long' }).format(new Date(iso)) : null;

function PasswordSection() {
  const auth = useAuth();
  const [, nav] = useLocation();
  const m = useChangeVolunteerPassword({ request: auth.request });
  const [f, setF] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [err, setErr] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const x: Errors = {};
    if (!f.currentPassword) x.currentPassword = 'Enter your current password';
    if (f.password.length < 8) x.password = 'Use at least 8 characters';
    else if (new TextEncoder().encode(f.password).length > 72) x.password = 'This password is too long. Try a shorter password with at least 8 characters.';
    if (f.confirmPassword !== f.password) x.confirmPassword = 'Passwords do not match';
    setErr(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    try {
      await m.mutateAsync({ data: f });
      setF({ currentPassword: '', password: '', confirmPassword: '' });
      m.reset();
      // Drop the entire authenticated client, not just /me: a stale public-page
      // guard can otherwise navigate back to the dashboard after session revocation.
      window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/signin?password-changed=1`);
    } catch (e2) {
      const r = readError(e2, "We couldn't change your password.");
      setErr(r.status === 400 && /current password/i.test(r.message) ? { currentPassword: r.message } : { form: r.message });
      if (r.status === 401 || r.status === 403) {
        await auth.refresh().catch(() => undefined);
        nav(r.nextPath ?? '/signin', { replace: true });
      }
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2 className="alliance-display">Password</h2>
      <p className="mt-2 text-sm">Changing your password signs you out everywhere.</p>
      <form noValidate onSubmit={e => { void submit(e); }} className="mt-4 grid gap-4" data-testid="form-password">
        <input type="email" name="username" autoComplete="username" value={auth.session?.email ?? ''} readOnly tabIndex={-1} aria-label="Account email" className="sr-only" />
        {err.form && <Notice>{err.form}</Notice>}
        <fieldset disabled={busy} className="contents">
        <PasswordField label="Current password" autoComplete="current-password" value={f.currentPassword} error={err.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} data-testid="input-current-password" />
        <PasswordField label="New password" autoComplete="new-password" hint="Use at least 8 characters." value={f.password} error={err.password} onChange={e => setF({ ...f, password: e.target.value })} data-testid="input-new-password" />
        <PasswordField label="Confirm new password" autoComplete="new-password" value={f.confirmPassword} error={err.confirmPassword} onChange={e => setF({ ...f, confirmPassword: e.target.value })} data-testid="input-confirm-password" />
        <Button type="submit" disabled={busy} data-testid="button-change-password">{busy ? 'Changing password' : 'Change password'}</Button>
        </fieldset>
      </form>
    </Card>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const save = useUpdateVolunteerProfile({ request: auth.request });
  const p = me.profile;
  const [contact, setContact] = useState({ firstName: me.user.firstName, lastName: me.user.lastName, phone: me.user.phone ?? '' });
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const a: Record<string, unknown> = { ...(p?.onboardingAnswers ?? {}) };
    for (const q of onboardingQuestions) {
      if (q.profileField === 'county') a[q.id] = p?.county ?? a[q.id] ?? '';
      if (q.profileField === 'availabilityNotes') a[q.id] = p?.availabilityNotes ?? a[q.id] ?? '';
    }
    return a;
  });
  const [errors, setErrors] = useState<Errors>({});
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fallbackCounty, setFallbackCounty] = useState(p?.county ?? appConfig.defaultCounty);
  const [fallbackAvailability, setFallbackAvailability] = useState(p?.availabilityNotes ?? '');
  const field = (f: 'county' | 'availabilityNotes') => onboardingQuestions.find(q => q.profileField === f)?.id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const c = onboardingContactSchema.safeParse(contact);
    const a = buildOnboardingAnswersSchema().safeParse(answers);
    const errs = { ...(c.success ? {} : issues(c.error.issues)), ...(a.success ? {} : issues(a.error.issues)) };
    setErrors(errs);
    if (!c.success || !a.success) { setMsg({ kind: 'error', text: 'Please fix the highlighted answers.' }); return; }
    const cId = field('county'), aId = field('availabilityNotes');
    const county = String(cId ? a.data[cId] : fallbackCounty);
    if (!(appConfig.counties as readonly string[]).includes(county)) { setErrors({ ...(cId ? { [cId]: 'Choose a county' } : {}) }); return; }
    const notes = String(aId ? a.data[aId] ?? '' : fallbackAvailability).trim();
    setBusy(true);
    try {
      const res = await save.mutateAsync({ data: { ...c.data, county, availabilityNotes: notes === '' ? null : notes, answers: a.data } });
      qc.setQueryData(getGetMeQueryKey(), res);
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetVolunteerDashboardQueryKey() }),
        qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('/api/admin/volunteers') }),
      ]);
      setMsg({ kind: 'success', text: 'Your profile is saved.' });
    } catch (e2) { setMsg({ kind: 'error', text: readError(e2, "We couldn't save your profile. Please try again.").message }); }
    setBusy(false);
  }
  const set = (id: string, v: unknown) => { setAnswers(a => ({ ...a, [id]: v })); setErrors(x => ({ ...x, [id]: '' })); };
  const ro: [string, string | null][] = [
    ['Email', me.user.email], ['Volunteer status', p ? label(p.status) : null],
    ['Training certification', p ? label(p.certificationStatus) : null], ['Background check', p ? label(p.backgroundCheckStatus) : null],
    ['Agreement', p?.agreementAcknowledgedAt ? `Acknowledged ${date(p.agreementAcknowledgedAt)}${p.agreementVersion ? ` (${p.agreementVersion})` : ''}` : 'Not yet acknowledged'],
  ];
  return (
    <VolunteerPage kicker="Your profile" title="Profile and settings">
      <Card>
        <h2 className="alliance-display">Your account</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="profile-readonly">
          {ro.map(([k, v]) => <div key={k}><dt className="alliance-label">{k}</dt><dd className="mt-0.5 break-all">{v ?? 'Not available'}</dd></div>)}
        </dl>
      </Card>
      <Card>
        <h2 className="alliance-display">Your details</h2>
        <form noValidate onSubmit={e => { void submit(e); }} className="mt-4 grid gap-5" data-testid="form-profile">
          <div>{msg && <Notice kind={msg.kind}>{msg.text}</Notice>}</div>
          <fieldset disabled={busy} className="contents">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" autoComplete="given-name" maxLength={100} value={contact.firstName} error={errors.firstName} onChange={e => setContact({ ...contact, firstName: e.target.value })} data-testid="input-first-name" />
            <Field label="Last name" autoComplete="family-name" maxLength={100} value={contact.lastName} error={errors.lastName} onChange={e => setContact({ ...contact, lastName: e.target.value })} data-testid="input-last-name" />
            <Field className="sm:col-span-2" label="Mobile phone" type="tel" autoComplete="tel" maxLength={40} value={contact.phone} error={errors.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} data-testid="input-phone" />
          </div>
          {!field('county') && <div><label htmlFor="profile-county" className="mb-1.5 block text-sm font-bold">County</label>
            <select id="profile-county" className="alliance-input" value={fallbackCounty} onChange={e => setFallbackCounty(e.target.value)}>
              {appConfig.counties.map(county => <option key={county} value={county}>{county}</option>)}
            </select></div>}
          {!field('availabilityNotes') && <div><label htmlFor="profile-availability" className="mb-1.5 block text-sm font-bold">Availability notes</label>
            <textarea id="profile-availability" className="alliance-input" maxLength={5000} value={fallbackAvailability} onChange={e => setFallbackAvailability(e.target.value)} /></div>}
          {onboardingQuestions.map(q => <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={v => set(q.id, v)} />)}
          <Button type="submit" disabled={busy} data-testid="button-save-profile">{busy ? 'Saving' : 'Save profile'}</Button>
          </fieldset>
        </form>
      </Card>
      <PasswordSection />
    </VolunteerPage>
  );
}

export const Profile = volunteerRoute(me => <ProfileForm key={me.user.id} me={me} />);
