import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { PublicLayout, Button } from '@/components/brand-system';
import { AuthHeading, Field, Notice, PasswordField, PublicAuthGate, SubmitButton } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';

function ForgotForm() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const r = await auth.forgot(email.trim());
      setDone(r.message || 'If that email belongs to an account, a reset link is on its way.');
    } catch (ex) { setErr(readError(ex).message); } finally { setBusy(false); }
  }
  return (
    <PublicLayout>
      <AuthHeading label="Password help" title="Reset your password">Enter your email and we’ll send you a link to choose a new one.</AuthHeading>
      {done ? (
        <>
          <Notice kind="success">{done}</Notice>
          <Link href="/signin" className="inline-flex min-h-11 items-center text-sm font-bold text-teal-text underline underline-offset-4">Back to sign in</Link>
        </>
      ) : (
        <>
          {err && <Notice>{err}</Notice>}
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            <SubmitButton busy={busy} busyText="Sending">Send reset link</SubmitButton>
          </form>
          <p className="mt-6 text-sm"><Link href="/signin" className="font-bold text-teal-text underline underline-offset-4">Back to sign in</Link></p>
        </>
      )}
    </PublicLayout>
  );
}
export function ForgotPassword() { return <PublicAuthGate verifiedOnly><ForgotForm /></PublicAuthGate>; }

function ResetForm() {
  const auth = useAuth();
  // Token lives in memory only; the query string is stripped after a successful reset.
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(!/^[a-f0-9]{64}$/.test(token));
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwErr = password && password.length < 8 ? 'Use at least 8 characters.' : null;
  const matchErr = confirm && password !== confirm ? 'Passwords do not match.' : null;

  useEffect(() => { if (done) window.history.replaceState(null, '', window.location.pathname); }, [done]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (password.length < 8) return setErr('Your password needs at least 8 characters.');
    if (password !== confirm) return setErr('The two passwords do not match.');
    setBusy(true);
    try {
      const r = await auth.reset({ token, password, confirmPassword: confirm });
      setPassword(''); setConfirm('');
      setDone(r.message || 'Your password has been updated.');
    } catch (ex) {
      const f = readError(ex);
      if (f.code === 'TOKEN_INVALID') setInvalid(true);
      else setErr(f.message);
    } finally { setBusy(false); }
  }

  return (
    <PublicLayout>
      <AuthHeading label="Password help" title="Choose a new password" />
      {done ? (
        <>
          <Notice kind="success">{done}</Notice>
          <Button asChild><Link href="/signin">Sign in</Link></Button>
        </>
      ) : invalid ? (
        <>
          <Notice>This reset link is invalid or has expired. Reset links work once and only for a short time.</Notice>
          <Button asChild><Link href="/forgot-password">Request a new link</Link></Button>
        </>
      ) : (
        <>
          {err && <Notice>{err}</Notice>}
          <form onSubmit={submit} className="grid gap-4">
            <PasswordField label="New password" required autoComplete="new-password" minLength={8} maxLength={72}
              error={pwErr} hint="At least 8 characters." value={password} onChange={e => setPassword(e.target.value)} />
            <PasswordField label="Confirm new password" required autoComplete="new-password" minLength={8} maxLength={72}
              error={matchErr} value={confirm} onChange={e => setConfirm(e.target.value)} />
            <SubmitButton busy={busy} busyText="Saving">Update password</SubmitButton>
          </form>
        </>
      )}
    </PublicLayout>
  );
}
export function ResetPassword() { return <PublicAuthGate allowAuthed><ResetForm /></PublicAuthGate>; }
