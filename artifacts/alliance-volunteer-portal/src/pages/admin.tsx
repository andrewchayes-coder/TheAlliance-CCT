import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import {
  getListTeamUsersQueryKey, useListTeamUsers, type AdminInviteResult, type ListTeamUsersParams, type Me, type PublicUser,
} from '@workspace/api-client-react';
import { AppLayout, Button, EmptyState, PublicLayout, StatusBadge } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { RequireAdmin } from '@/auth/guards';
import { Field, Notice, PasswordField, AuthHeading, SubmitButton, PublicAuthGate } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';

const PAGE = 25;
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;

function AdminHomeBody({ me }: { me: Me }) {
  const auth = useAuth();
  const [, nav] = useLocation();
  const [busy, setBusy] = useState(false);
  async function out() {
    setBusy(true);
    try { await auth.signout(); nav('/'); } catch { setBusy(false); }
  }
  return (
    <AppLayout role="admin">
      <p className="alliance-label">Administration</p>
      <h1 className="alliance-display mt-3 text-[22px] md:text-[28px]">Welcome, {me.user.firstName}</h1>
      <p className="mt-3 max-w-2xl">Manage who can help the Resource Coordination Program support local families.</p>
      <Link href="/admin/team" data-testid="link-admin-team"
        className="alliance-card mt-6 flex items-center gap-4 hover:shadow-md focus-visible:outline-2 focus-visible:outline-teal">
        <Users size={26} aria-hidden="true" className="shrink-0 text-teal-text" />
        <span className="min-w-0">
          <span className="block font-bold">Team accounts</span>
          <span className="block text-sm">Invite admins, and activate or deactivate admin and volunteer accounts.</span>
        </span>
        <ChevronRight size={20} aria-hidden="true" className="ml-auto shrink-0" />
      </Link>
      <div className="mt-8"><Button variant="secondary" onClick={out} disabled={busy} data-testid="button-signout">{busy ? 'Signing out' : 'Sign out'}</Button></div>
    </AppLayout>
  );
}
export const AdminHome = () => <RequireAdmin>{me => <AdminHomeBody me={me} />}</RequireAdmin>;

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
      <h2 id="invite-h" className="alliance-display text-[15px]">Invite an admin</h2>
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
          <AlertDialogTitle className="alliance-display text-base">
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
      <Link href="/admin" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-teal-text underline underline-offset-4"><ChevronLeft size={16} aria-hidden="true" />Admin home</Link>
      <h1 className="alliance-display text-[22px] md:text-[28px]">Team accounts</h1>
      <p className="mb-6 mt-2 max-w-2xl">Invite admins and control who can sign in.</p>
      <InviteCard />
      <section className="alliance-card" aria-labelledby="team-h">
        <h2 id="team-h" className="sr-only">Accounts</h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div role="group" aria-label="Filter by role" className="grid grid-cols-2 gap-1 rounded-lg bg-gray p-1 md:w-72">
            {(['admin', 'volunteer'] as const).map(r => (
              <button key={r} type="button" aria-pressed={role === r} data-testid={`filter-${r}`}
                onClick={() => { setRole(r); setOffset(0); }}
                className={`min-h-11 rounded-md text-sm font-bold capitalize ${role === r ? 'bg-white shadow-sm' : ''}`}>{r}s</button>
            ))}
          </div>
          <div className="relative md:w-80">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" aria-label="Search by name or email" placeholder="Search name or email" maxLength={100}
              className="alliance-input pl-10" value={text} onChange={e => setText(e.target.value)} data-testid="input-search" />
          </div>
        </div>
        <div aria-live="polite" className="mt-4">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>

        {list.isPending ? (
          <div className="mt-4 space-y-3" role="status" aria-busy="true"><span className="sr-only">Loading accounts</span>
            {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : list.isError && !data ? (
          <div className="mt-4"><Notice>We couldn't load accounts.</Notice><Button onClick={() => { void list.refetch(); }}>Try again</Button></div>
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
                  <li key={u.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center" data-testid={`row-user-${u.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{u.firstName} {u.lastName}{self && <span className="ml-2 text-sm font-normal">(you)</span>}</p>
                      <p className="break-all text-sm">{u.email}</p>
                      <p className="mt-1 text-xs text-navy-soft">
                        {u.lastLoginAt ? `Last sign-in ${fmtDate(u.lastLoginAt)}` : 'Never signed in'} · Added {fmtDate(u.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
