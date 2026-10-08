import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { PublicLayout, Button } from '@/components/brand-system';
import { AuthHeading, AuthLoading, Notice, SessionFailed } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';

type Done = { nextPath: string };
const inflight = new Map<string, Promise<Done>>();

export function VerifyEmailPage() {
  const auth = useAuth();
  const { session, sessionLoading, sessionError, flash, setFlash } = auth;
  const [, nav] = useLocation();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [cool, setCool] = useState(0);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (session && !seeded) { setCool(session.resendAfterSeconds); setSeeded(true); }
  }, [session, seeded]);
  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cool]);
  useEffect(() => {
    if (!session || leaving) return;
    if (!session.authenticated) nav('/signin', { replace: true });
    else if (session.verified) nav(session.nextPath, { replace: true });
  }, [session, nav, leaving]);

  if (sessionLoading) return <AuthLoading />;
  if (!session) return sessionError ? <SessionFailed /> : <AuthLoading />;
  if (!session.authenticated || session.verified) return <AuthLoading label="One moment" />;

  async function resend() {
    if (busy || cool > 0) return;
    setBusy(true); setErr(null); setOkMsg(null); setFlash(null);
    try {
      const r = await auth.resend();
      setOkMsg(r.message || 'A new verification link is on its way.');
      const s = await auth.refresh();
      setCool(s.resendAfterSeconds);
    } catch (ex) {
      const f = readError(ex);
      setErr(f.message);
      if (f.retryAfterSeconds) setCool(f.retryAfterSeconds);
    } finally { setBusy(false); }
  }
  async function startOver() {
    setLeaving(true);
    try {
      await auth.signout();
      // Start with a fresh auth-query cache instead of racing public-page redirects.
      window.location.replace(`${import.meta.env.BASE_URL}signup`);
    }
    catch (error) {
      setErr(readError(error, 'We couldn’t start over. Please try again.').message);
      setLeaving(false);
    }
  }

  return (
    <PublicLayout>
      <AuthHeading label="One more step" title="Check your inbox">
        We sent a verification link to <strong className="break-all">{session.email}</strong>. Open it on this device to finish setting up.
      </AuthHeading>
      {(flash || session.notice) && !err && <Notice kind="info">{flash || session.notice}</Notice>}
      {err && <Notice>{err}</Notice>}
      {okMsg && <Notice kind="success">{okMsg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" onClick={resend} disabled={busy || cool > 0 || leaving} aria-busy={busy}>
          {busy ? 'Sending' : cool > 0 ? `Resend available in ${cool}s` : 'Resend email'}
        </Button>
        <Button type="button" variant="secondary" onClick={startOver} disabled={leaving}>
          {leaving ? 'Signing out' : 'Wrong email? Start over'}
        </Button>
      </div>
      <p className="mt-6 text-sm">Can’t find it? Check your spam folder; the link expires after a while.</p>
    </PublicLayout>
  );
}

export function VerifyTokenPage() {
  const auth = useAuth();
  const { session, sessionLoading, sessionError } = auth;
  const [, nav] = useLocation();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'error'; message: string }>(
    token ? { kind: 'working' } : { kind: 'error', message: 'This verification link is missing its code.' });
  const ready = !!session;

  // Strip the token from the address bar before any request, so it can't leak via referrer.
  useEffect(() => { if (window.location.search) window.history.replaceState(null, '', window.location.pathname); }, []);

  useEffect(() => {
    if (!token || !ready) return;
    let live = true;
    let p = inflight.get(token);
    if (!p) {
      p = auth.verify(token).then(r => ({ nextPath: r.nextPath || '/onboarding' }));
      const settled = () => { inflight.delete(token); };
      p.then(settled, settled);
      inflight.set(token, p);
    }
    p.then(r => { if (live) nav(r.nextPath, { replace: true }); })
      .catch(ex => {
        if (live) setState({ kind: 'error', message: readError(ex, 'We couldn’t verify that link.').message });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ready]);

  if (sessionLoading && token) return <AuthLoading label="Verifying your email" />;
  if (!session && sessionError) return <SessionFailed />;

  return (
    <PublicLayout>
      {state.kind === 'working' ? (
        <div role="status" aria-live="polite">
          <AuthHeading label="Verifying" title="Confirming your email" >Just a moment.</AuthHeading>
        </div>
      ) : (
        <>
          <AuthHeading label="Verification" title="That link didn’t work" />
          <Notice>{state.message}</Notice>
          <p className="mb-5 text-sm">Links expire and can only be used once. Sign in and we can send you a fresh one.</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild><Link href={session?.authenticated ? '/verify-email' : '/signin'}>{session?.authenticated ? 'Request a new link' : 'Sign in'}</Link></Button>
            <Button asChild variant="secondary"><Link href="/signup">Create an account</Link></Button>
          </div>
        </>
      )}
    </PublicLayout>
  );
}
