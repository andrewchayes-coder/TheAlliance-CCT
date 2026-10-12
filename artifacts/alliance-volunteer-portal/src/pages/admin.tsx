import { ContactLink } from '@/components/shift-cards';
import { PageHeader } from '@/components/page-header';
import { useEffect, useState, type FormEvent } from 'react';
import { appConfig } from '@workspace/shared/appConfig';
import { formatPhone, normalizeVolunteerStatus } from '@workspace/shared/profileFields';
import { Link, useLocation, useParams } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, Search } from 'lucide-react';
import { AdminOverviewPage } from '@/pages/admin-dispatch';
import { TestAccountsCard } from '@/components/test-accounts-card';
import { TestBadge } from '@/components/test-badge';
import {
  getGetVolunteerOnboardingQueryKey, getListTeamUsersQueryKey, useGetVolunteerOnboarding, useListTeamUsers, type AdminInviteResult, type ListTeamUsersParams, type Me, type PublicUser,
} from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, PublicLayout, StatusBadge } from '@/components/brand-system';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AccountEditor } from '@/components/account-editor';
import { RequireAdmin } from '@/auth/guards';
import { Field, Notice, PasswordField, AuthHeading, SubmitButton, PublicAuthGate } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';

const PAGE = 25;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium' }) : null;

export const AdminHome = () => <AdminOverviewPage />;

function InviteCard() {
  const auth = useAuth();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<AdminInviteResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await auth.inviteAdmin({ firstName: first.trim(), lastName: last.trim(), email: email.trim() });
      setRes(r);
      if (r.delivery !== 'failed') { setFirst(''); setLast(''); setEmail(''); }
    } catch (ex) { setErr(readError(ex).message); } finally { setBusy(false); }
  }
  const headline = res?.delivery === 'sent' ? `Invitation emailed to ${res.email}.`
    : res?.delivery === 'logged' ? `Invitation created for ${res.email}. No email was sent; the message was written to the development console.`
    : res ? `${res.email} was added as a pending admin, but the invitation email could not be sent. Submit the same details again to retry.` : '';
  return (
    <section className="alliance-card mb-6" aria-labelledby="invite-h">
      <h2 id="invite-h" className="alliance-display">Invite an admin</h2>
      <p className="mt-2 text-sm">They will have 7 days to accept and set a password. Submitting the same details again resends the invitation.</p>
      <div aria-live="polite" className="mt-4">
        {err && <Notice>{err}</Notice>}
        {res && <Notice kind={res.delivery === 'failed' ? 'error' : res.delivery === 'logged' ? 'info' : 'success'}>
          <p className="font-bold">{headline}</p>{res.message && <p className="mt-1">{res.message}</p>}</Notice>}
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" required maxLength={100} autoComplete="off" value={first} onChange={e => setFirst(e.target.value)} />
        <Field label="Last name" required maxLength={100} autoComplete="off" value={last} onChange={e => setLast(e.target.value)} />
        <Field className="sm:col-span-2" label="Email" type="email" required maxLength={254} autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
        <div className="sm:col-span-2"><SubmitButton busy={busy} busyText="Sending invitation">Send invitation</SubmitButton></div>
      </form>
    </section>
  );
}

function ConfirmStatus({ target, selfId, onClose }: { target: { user: PublicUser; next: boolean } | null; selfId: string; onClose: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const u = target?.user;
  async function go() {
    if (!target || busy) return;
    setBusy(true); setErr(null);
    try { await auth.setActive(target.user.id, target.next); onClose(); }
    catch (ex) { setErr(readError(ex).message); } finally { setBusy(false); }
  }
  return (
    <AlertDialog open={!!target} onOpenChange={o => { if (!o && !busy) { setErr(null); onClose(); } }}>
      <AlertDialogContent className="bg-white text-navy">
        <AlertDialogHeader>
          <AlertDialogTitle className="alliance-display">
            {target?.next ? 'Reactivate' : 'Deactivate'} {u?.firstName} {u?.lastName}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-navy">
              {target?.next ? (
                <p>{u?.email} will be able to sign in again. Links that were revoked during deactivation stay revoked.</p>
              ) : (
                <>
                  <p>Deactivating {u?.email} will:</p>
                  <ul className="list-disc pl-5">
                    <li>end all of their signed-in sessions now,</li>
                    <li>prevent them from signing in, and</li>
                    <li>revoke their existing links.</li>
                  </ul>
                </>
              )}
              {u?.id === selfId && <p className="font-bold">You cannot change your own status.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {err && <Notice>{err}</Notice>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} data-testid="button-cancel-status">Cancel</AlertDialogCancel>
          <Button type="button" onClick={go} disabled={busy || u?.id === selfId} data-testid="button-confirm-status">
            {busy ? 'Saving' : target?.next ? 'Reactivate account' : 'Deactivate account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TeamBody({ me }: { me: Me }) {
  const auth = useAuth();
  const [role, setRole] = useState<'admin' | 'volunteer'>('admin');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<{ user: PublicUser; next: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [text]);

  const params: ListTeamUsersParams = { role, limit: PAGE, offset, ...(q ? { q } : {}) };
  const list = useListTeamUsers(params, {
    query: { queryKey: getListTeamUsersQueryKey(params), staleTime: FRESH_MS, retry: false, placeholderData: keepPreviousData },
    request: FETCH_CREDS,
  });
  const data = list.data;
  const total = data?.total ?? 0;

  async function resend(u: PublicUser) {
    setResending(u.id); setNote(null);
    try {
      const r = await auth.inviteAdmin({ firstName: u.firstName, lastName: u.lastName, email: u.email });
      setNote({ kind: r.delivery === 'sent' ? 'success' : r.delivery === 'logged' ? 'info' : 'error',
        text: r.delivery === 'sent' ? `Invitation re-sent to ${r.email}.`
          : r.delivery === 'logged' ? `Invitation refreshed for ${r.email}. No email was sent; it was logged to the development console.`
          : `The invitation for ${r.email} could not be emailed. Try again.` });
    } catch (ex) { setNote({ kind: 'error', text: readError(ex).message }); } finally { setResending(null); }
  }

  return (
    <AppLayout role="admin">
      <PageHeader back={<Link href="/admin" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-blue underline underline-offset-4"><ChevronLeft size={16} aria-hidden="true" />Admin home</Link>} title="Team accounts" description="Invite admins and control who can sign in." />
      <InviteCard />
      <TestAccountsCard />
      <section className="alliance-card" aria-labelledby="team-h">
        <h2 id="team-h" className="sr-only">Accounts</h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filter by role" className="grid grid-cols-2 gap-1 rounded-lg bg-gray p-1 lg:w-72">
            {(['admin', 'volunteer'] as const).map(r => (
              <button key={r} type="button" aria-pressed={role === r} data-testid={`filter-${r}`}
                onClick={() => { setRole(r); setOffset(0); }}
                className={`min-h-11 rounded-md text-sm font-bold capitalize ${role === r ? 'bg-white shadow-sm' : ''}`}>{r}s</button>
            ))}
          </div>
          <div className="relative lg:w-80">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" aria-label="Search by name or email" placeholder="Search name or email" maxLength={100}
              className="alliance-input pl-10" value={text} onChange={e => setText(e.target.value)} data-testid="input-search" />
          </div>
        </div>
        {role === 'volunteer' && <p className="mt-4 text-sm"><a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/admin/volunteers/onboarding.csv`} download className="font-bold text-blue underline underline-offset-4" data-testid="link-onboarding-csv">Download onboarding CSV</a></p>}
        <div className="mt-4">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>

        {list.isPending ? (
          <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading accounts</span>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : list.isError && !data ? (
          <div className="mt-4"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void list.refetch(); }}>Try again</Button></div>
        ) : data && data.users.length === 0 ? (
          <div className="mt-4"><EmptyState title={q ? 'No matches' : `No ${role}s yet`}
            description={q ? 'Try a different name or email.' : role === 'admin' ? 'Invite an admin above to get started.' : 'Volunteers appear here after they sign up.'} /></div>
        ) : data && (
          <>
            {list.isError && <div className="mt-4"><Notice>Couldn't refresh the list. Showing the last loaded results.</Notice></div>}
            <ul className={`mt-4 divide-y divide-gray ${list.isFetching ? 'opacity-70' : ''}`} aria-label={`${role} accounts`} aria-busy={list.isFetching}>
              {data.users.map(u => {
                const self = u.id === me.user.id;
                const pending = u.role === 'admin' && !u.emailVerifiedAt;
                return (
                  <li key={u.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:flex-wrap lg:items-center" data-testid={`row-user-${u.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{u.firstName} {u.lastName}<TestBadge test={u.isTestAccount} />{self && <span className="ml-2 text-sm font-normal">(you)</span>}</p>
                      <p className="break-all text-sm">{u.email}</p>
                      <p className="mt-1 text-xs text-navy-soft">
                        {u.lastLoginAt ? `Last sign-in ${fmtDate(u.lastLoginAt)}` : 'Never signed in'} · Added {fmtDate(u.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {u.role === 'volunteer' && <Button asChild variant="secondary"><Link href={`/admin/volunteers/${u.id}/onboarding`} data-testid={`link-onboarding-${u.id}`}>Review onboarding</Link></Button>}
                      {u.role === 'admin' && (self
                        ? <Button asChild variant="secondary"><Link href="/profile" data-testid={`link-edit-${u.id}`}>My profile</Link></Button>
                        : <Button type="button" variant="secondary" aria-expanded={editing === u.id} onClick={() => setEditing(editing === u.id ? null : u.id)} data-testid={`button-edit-${u.id}`}>{editing === u.id ? 'Close editor' : 'Edit account'}</Button>)}
                      {pending && <StatusBadge status="attention">Invitation pending</StatusBadge>}
                      <StatusBadge status={u.isActive ? 'good' : 'blocked'}>{u.isActive ? 'Active' : 'Inactive'}</StatusBadge>
                      {pending && u.isActive && (
                        <Button type="button" variant="secondary" disabled={resending === u.id} onClick={() => { void resend(u); }} data-testid={`button-resend-${u.id}`}>
                          {resending === u.id ? 'Sending' : 'Resend invitation'}
                        </Button>
                      )}
                      <Button type="button" variant="secondary" disabled={self}
                        title={self ? 'You cannot change your own status' : undefined}
                        aria-label={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.firstName} ${u.lastName}${self ? ' (unavailable: this is you)' : ''}`}
                        onClick={() => setTarget({ user: u, next: !u.isActive })} data-testid={`button-status-${u.id}`}>
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                    {editing === u.id && u.role === 'admin' && !self && <div className="w-full lg:basis-full"><AccountEditor key={u.id} userId={u.id} managed /></div>}
                  </li>
                );
              })}
            </ul>
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
              <span data-testid="text-range">{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} data-testid="button-prev">Previous</Button>
                <Button type="button" variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} data-testid="button-next">Next</Button>
              </div>
            </nav>
          </>
        )}
      </section>
      <ConfirmStatus target={target} selfId={me.user.id} onClose={() => setTarget(null)} />
    </AppLayout>
  );
}
export const AdminTeam = () => <RequireAdmin>{me => <TeamBody me={me} />}</RequireAdmin>;

function AcceptForm() {
  const auth = useAuth();
  const [, nav] = useLocation();
  // Token lives in memory only and is removed from the address bar immediately.
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(!/^[a-f0-9]{64}$/.test(token));
  const [busy, setBusy] = useState(false);
  const pwErr = password && password.length < 8 ? 'Use at least 8 characters.' : null;
  const matchErr = confirm && password !== confirm ? 'Passwords do not match.' : null;

  useEffect(() => { if (window.location.search) window.history.replaceState(null, '', window.location.pathname); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (password.length < 8) return setErr('Your password needs at least 8 characters.');
    if (password !== confirm) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      const r = await auth.acceptInvite({ token, password, confirmPassword: confirm });
      setPassword(''); setConfirm('');
      nav(r.nextPath || '/admin', { replace: true });
    } catch (ex) {
      const f = readError(ex);
      if (f.code === 'TOKEN_INVALID') setInvalid(true); else setErr(f.message);
      setBusy(false);
    }
  }

  return (
    <PublicLayout>
      <AuthHeading label="Admin invitation" title="Set your password" />
      {invalid ? (
        <>
          <Notice>This invitation is invalid, expired, or already used. Invitations last 7 days and work once. Please contact the admin who invited you to send a new one.</Notice>
          <Button asChild><Link href="/signin">Go to sign in</Link></Button>
        </>
      ) : (
        <>
          <p className="mb-5">Choose a password to accept your invitation. You'll be signed in to the admin area.</p>
          {err && <Notice>{err}</Notice>}
          <form onSubmit={submit} className="grid gap-4">
            <PasswordField label="Password" required autoComplete="new-password" minLength={8} maxLength={72}
              error={pwErr} hint="At least 8 characters." value={password} onChange={e => setPassword(e.target.value)} />
            <PasswordField label="Confirm password" required autoComplete="new-password" minLength={8} maxLength={72}
              error={matchErr} value={confirm} onChange={e => setConfirm(e.target.value)} />
            <SubmitButton busy={busy} busyText="Accepting">Accept invitation</SubmitButton>
          </form>
        </>
      )}
    </PublicLayout>
  );
}
export function AcceptInvite() { return <PublicAuthGate allowAuthed><AcceptForm /></PublicAuthGate>; }

const fmtTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded';

function VolunteerOnboardingBody() {
  const { userId = '' } = useParams<{ userId: string }>();
  const q = useGetVolunteerOnboarding(userId, { query: { queryKey: getGetVolunteerOnboardingQueryKey(userId), enabled: !!userId, retry: false }, request: FETCH_CREDS });
  const d = q.data;
  const p = d?.profile;
  return (
    <AppLayout role="admin">
      <PageHeader back={<Link href="/admin/team" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-blue underline underline-offset-4"><ChevronLeft size={16} aria-hidden="true" />Team accounts</Link>} title="Volunteer onboarding" />
      {q.isPending ? <div className="mt-6 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading</span>{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        : q.isError || !d ? <div className="mt-6"><Notice>We couldn’t open this volunteer’s onboarding details just now. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button onClick={() => { void q.refetch(); }}>Try again</Button></div>
        : (
          <>
            <section className="alliance-card mt-6" aria-labelledby="ob-contact">
              <h2 id="ob-contact" className="alliance-display">{d.user.firstName} {d.user.lastName}</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="alliance-label">Email</dt><dd className="break-all">{d.user.email}</dd></div>
                <div><dt className="alliance-label">Phone</dt><dd>{formatPhone(d.user.phone) || 'Not provided'}</dd></div>
                <div><dt className="alliance-label">Status</dt><dd data-testid="text-onboarding-status">{p ? (p.onboardingCompletedAt ? 'Onboarding complete' : 'In progress (draft)') : 'Not started'}</dd></div>
                <div><dt className="alliance-label">Volunteer status</dt><dd className="capitalize">{p ? normalizeVolunteerStatus(p.status) : 'None'}</dd></div>
                <div><dt className="alliance-label">Completed</dt><dd>{fmtTime(p?.onboardingCompletedAt)}</dd></div>
                {appConfig.requireAgreementAcknowledgment && <div><dt className="alliance-label">Agreement acknowledged</dt><dd>{fmtTime(p?.agreementAcknowledgedAt)}</dd></div>}
                {appConfig.requireAgreementAcknowledgment && <div><dt className="alliance-label">Agreement version</dt><dd className="break-all">{p?.agreementVersion ?? 'None'}</dd></div>}
                <div><dt className="alliance-label">Date of birth</dt><dd>{p?.dateOfBirth ?? 'Not provided'}</dd></div>
                <div><dt className="alliance-label">Home address</dt><dd>{p?.addressLine1 ? `${p.addressLine1}, ${p.city ?? ''} ${p.state ?? ''} ${p.zip ?? ''}` : 'Not provided'}</dd></div>
                <div><dt className="alliance-label">Emergency contact</dt><dd>{p?.emergencyContactName ? `${p.emergencyContactName} (${p.emergencyContactRelationship ?? ''}) ${formatPhone(p.emergencyContactPhone)}` : 'Not provided'}</dd></div>
                <div><dt className="alliance-label">Last updated</dt><dd>{fmtTime(p?.updatedAt)}</dd></div>
              </dl>
            </section>
            {onboardingQuestions.length > 0 && <section className="alliance-card mt-6" aria-labelledby="ob-answers">
              <h2 id="ob-answers" className="alliance-display">Answers</h2>
              <dl className="mt-3 divide-y divide-gray">
                {onboardingQuestions.map(qn => {
                  const v = p?.onboardingAnswers?.[qn.id];
                  const text = v === undefined ? '' : formatOnboardingAnswer(v);
                  return (
                    <div key={qn.id} className="py-3" data-testid={`answer-${qn.id}`}>
                      <dt className="text-sm font-bold">{qn.label}</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words">{text || <span className="text-navy-soft">No answer</span>}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>}
          </>
        )}
    </AppLayout>
  );
}
export const AdminVolunteerOnboarding = () => <RequireAdmin>{() => <VolunteerOnboardingBody />}</RequireAdmin>;
