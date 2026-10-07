import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { PublicLayout, Button } from '@/components/brand-system';
import { AuthHeading, Field, Notice, PasswordField, PublicAuthGate, SubmitButton } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';

function urlError(): string | null {
  const e = new URLSearchParams(window.location.search).get('error');
  if (e === 'google_failed') return 'Google sign-in didn’t complete. You can try again or use your email and password.';
  if (e === 'google_unavailable') return 'Google sign-in isn’t available right now. Please use your email and password.';
  if (e === 'account_inactive') return "Your account isn't active. Please contact The Alliance.";
  return null;
}

function Form() {
  const auth = useAuth();
  const [, nav] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(urlError);
  const [gNote, setGNote] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const r = await auth.signin({ email: email.trim(), password });
      nav(r.nextPath || '/dashboard');
    } catch (ex) { setErr(readError(ex).message); } finally { setBusy(false); }
  }
  function google() {
    if (auth.session?.googleEnabled) window.location.assign('/api/auth/google');
    else setGNote(true);
  }

  return (
    <PublicLayout>
      <AuthHeading label="Welcome back" title="Sign in to your volunteer account">
        Good to see you again. Pick up where you left off.
      </AuthHeading>
      {auth.session?.notice && <Notice kind="info">{auth.session.notice}</Notice>}
      {err && <Notice>{err}</Notice>}
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <PasswordField label="Password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <div className="text-right text-sm"><Link href="/forgot-password" className="font-bold text-teal-text underline underline-offset-4">Forgot password?</Link></div>
        <SubmitButton busy={busy} busyText="Signing in">Sign in</SubmitButton>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider" aria-hidden="true">
        <span className="h-px flex-1 bg-gray" />or<span className="h-px flex-1 bg-gray" />
      </div>
      <Button type="button" variant="secondary" className="w-full" onClick={google} aria-describedby={gNote ? 'g-note' : undefined}>Continue with Google</Button>
      {gNote && <div id="g-note" className="mt-4"><Notice kind="info">Google sign-in hasn’t been set up for this portal yet. Please use your email and password.</Notice></div>}
      <p className="mt-6 text-sm">New here? <Link href="/signup" className="font-bold text-teal-text underline underline-offset-4">Create a volunteer account</Link></p>
    </PublicLayout>
  );
}

export default function Signin() { return <PublicAuthGate><Form /></PublicAuthGate>; }
