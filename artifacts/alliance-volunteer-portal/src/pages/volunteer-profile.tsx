import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMeQueryKey, getGetVolunteerDashboardQueryKey, useUpdateVolunteerProfile, type Me,
} from '@workspace/api-client-react';
import { formatPhone, phoneDigits, normalizeVolunteerStatus, profileCompletionSchema, volunteerProfileEditSchema } from '@workspace/shared/profileFields';
import { ProfileFields, type ProfileKey, type ProfileValues } from '@/components/profile-fields';
import { buildOnboardingAnswersSchema, onboardingQuestions } from '@workspace/shared/onboardingQuestions';
import { appConfig } from '@workspace/shared/appConfig';
import { Button, Card } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { VolunteerPage } from '@/components/volunteer-ui';
import { AccountEditor } from '@/components/account-editor';
import { RequireVerified } from '@/auth/guards';
import { isProfileComplete } from '@/lib/profile-complete';
import { AppLayout } from '@/components/brand-system';
import { Link } from 'wouter';
import { QuestionField } from '@/pages/onboarding';

type Errors = Record<string, string>;
const issues = (list: { path: PropertyKey[]; message: string }[]): Errors => {
  const o: Errors = {};
  for (const i of list) { const k = String(i.path[0] ?? ''); if (k && !o[k]) o[k] = i.message; }
  return o;
};
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const date = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat('en-US', { timeZone: appConfig.timezone, dateStyle: 'long' }).format(new Date(iso)) : null;

function ProfileForm({ me }: { me: Me }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const save = useUpdateVolunteerProfile({ request: auth.request });
  const p = me.profile;
  const [values, setValues] = useState<ProfileValues>(() => ({
    firstName: me.user.firstName, lastName: me.user.lastName, phone: formatPhone(me.user.phone),
    dateOfBirth: p?.dateOfBirth ?? '', addressLine1: p?.addressLine1 ?? '', city: p?.city ?? '', state: p?.state || 'CA', zip: p?.zip ?? '',
    emergencyContactName: p?.emergencyContactName ?? '', emergencyContactRelationship: p?.emergencyContactRelationship ?? '',
    emergencyContactPhone: formatPhone(p?.emergencyContactPhone),
  }));
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({ ...(p?.onboardingAnswers ?? {}) }));
  const [errors, setErrors] = useState<Errors>({});
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const showQuestions = onboardingQuestions.length > 0;

  const setV = (k: ProfileKey, v: string) => { setValues(x => ({ ...x, [k]: v })); setErrors(x => ({ ...x, [k]: '' })); };
  const onBlur = (k: ProfileKey) => {
    if ((k === 'phone' || k === 'emergencyContactPhone') && values[k] && phoneDigits(values[k]).length <= 10) setValues(x => ({ ...x, [k]: formatPhone(x[k]) }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { dateOfBirth: _dob, ...editable } = values;
    void _dob;
    const c = volunteerProfileEditSchema.safeParse(editable);
    const a = showQuestions ? buildOnboardingAnswersSchema().safeParse(answers) : null;
    const errs = { ...(c.success ? {} : issues(c.error.issues)), ...(a && !a.success ? issues(a.error.issues) : {}) };
    setErrors(errs);
    if (!c.success || (a && !a.success)) { setMsg({ kind: 'error', text: 'Please fix the highlighted fields.' }); return; }
    // Schema fields are optional; the full set is validated as complete before sending.
    const full = profileCompletionSchema.omit({ dateOfBirth: true }).safeParse(editable);
    if (!full.success) { setErrors(issues(full.error.issues)); setMsg({ kind: 'error', text: 'Please fix the highlighted fields.' }); return; }
    setBusy(true);
    try {
      const res = await save.mutateAsync({ data: { ...full.data, ...(a?.success ? { answers: a.data } : {}) } });
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
  const status = p ? normalizeVolunteerStatus(p.status) : 'onboarding';
  const ro: [string, string | null][] = [
    ['Email', me.user.email], ['Volunteer status', label(status)],
    ['Date of birth', p?.dateOfBirth ? date(`${p.dateOfBirth}T12:00:00Z`) : null], ['Start date', p?.startDate ? date(`${p.startDate}T12:00:00Z`) : null],
    ...(appConfig.trackCertificationInApp ? [['Training certification', p ? label(p.certificationStatus) : null] as [string, string | null]] : []),
    ...(appConfig.trackBackgroundCheckInApp ? [['Background check', p ? label(p.backgroundCheckStatus) : null] as [string, string | null]] : []),
    ...(appConfig.requireAgreementAcknowledgment ? [['Agreement', p?.agreementAcknowledgedAt ? `Acknowledged ${date(p.agreementAcknowledgedAt)}${p.agreementVersion ? ` (${p.agreementVersion})` : ''}` : 'Not yet acknowledged'] as [string, string | null]] : []),
  ];
  return (
    <VolunteerPage kicker="Your profile" title="Profile and settings">
      <Card>
        <h2 className="alliance-display">Your account</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="profile-readonly">
          {ro.map(([k, v]) => <div key={k}><dt className="alliance-label">{k}</dt><dd className="mt-0.5 break-all">{v ?? 'Not available'}</dd></div>)}
        </dl>
        <p className="mt-3 text-sm text-navy-soft">To change your date of birth, status, or start date, contact Alliance staff.</p>
      </Card>
      <Card>
        <h2 className="alliance-display">Your details</h2>
        <form noValidate onSubmit={e => { void submit(e); }} className="mt-4 grid gap-5" data-testid="form-profile">
          <div>{msg && <Notice kind={msg.kind}>{msg.text}</Notice>}</div>
          <fieldset disabled={busy} className="contents">
            <ProfileFields values={values} errors={errors} email={me.user.email} emailEditableBelow showDob={false} onChange={setV} onBlur={onBlur} />
            {showQuestions && onboardingQuestions.map(q => <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={v => set(q.id, v)} />)}
            <Button type="submit" disabled={busy} data-testid="button-save-profile">{busy ? 'Saving' : 'Save profile'}</Button>
          </fieldset>
        </form>
      </Card>
      <AccountEditor key={me.user.id} userId={me.user.id} showDetails={false} />
    </VolunteerPage>
  );
}

function AccountOnly({ me, admin }: { me: Me; admin: boolean }) {
  return (
    <AppLayout role={admin ? 'admin' : 'volunteer'}>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={admin ? 'Administration' : 'Your profile'} title="My Profile" description="Update how Alliance staff and families reach you, and keep your sign-in secure." />
        {!admin && (
          <div className="mb-6"><Notice kind="info">Your volunteer onboarding isn't finished yet. You can manage your account here, then <Link href="/onboarding" className="font-bold underline underline-offset-4" data-testid="link-finish-onboarding">finish onboarding</Link> to complete your volunteer profile.</Notice></div>
        )}
        <AccountEditor key={me.user.id} userId={me.user.id} />
      </div>
    </AppLayout>
  );
}

export const Profile = () => (
  <RequireVerified area="account">
    {me => me.role === 'admin' || !isProfileComplete(me)
      ? <AccountOnly me={me} admin={me.role === 'admin'} />
      : <AppLayout role="volunteer"><ProfileForm key={`${me.user.id}|${me.user.firstName}|${me.user.lastName}|${me.user.phone ?? ''}`} me={me} /></AppLayout>}
  </RequireVerified>
);
