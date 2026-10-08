import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { PublicLayout } from '@/components/brand-system';
import { AuthHeading, Field, Notice, PasswordField, PublicAuthGate, SubmitButton } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';

function Form() {
  const auth = useAuth();
  const [, nav] = useLocation();
  const [v, setV] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }));
  const pwErr = v.password && v.password.length < 8 ? 'Use at least 8 characters.' : null;
  const matchErr = v.confirmPassword && v.password !== v.confirmPassword ? 'Please enter the same password in both fields.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (v.password.length < 8) return setErr('Your password needs at least 8 characters.');
    if (v.password !== v.confirmPassword) return setErr('Please enter the same password in both fields.');
    setBusy(true);
    try {
      const r = await auth.signup({
        firstName: v.firstName.trim(), lastName: v.lastName.trim(), email: v.email.trim(),
        phone: v.phone.trim(), password: v.password, confirmPassword: v.confirmPassword,
      });
      if (r.message) auth.setFlash(r.message);
      nav(r.nextPath || '/verify-email');
    } catch (ex) {
      const f = readError(ex);
      if (f.nextPath) {
        // Account exists but the email could not be delivered; the server tells us where to retry.
        auth.setFlash(f.message);
        try { await auth.refresh(); } catch { /* ignore */ }
        nav(f.nextPath);
      } else setErr(f.message);
    } finally { setBusy(false); }
  }

  return (
    <PublicLayout>
      <AuthHeading label="Volunteer sign up" title="Create your volunteer account">
        Thank you for helping local families find the support they need.
      </AuthHeading>
      {err && <Notice>{err}</Notice>}
      <form onSubmit={submit} className="grid gap-4" noValidate={false}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required autoComplete="given-name" maxLength={100} value={v.firstName} onChange={set('firstName')} />
          <Field label="Last name" required autoComplete="family-name" maxLength={100} value={v.lastName} onChange={set('lastName')} />
        </div>
        <Field label="Email" type="email" required autoComplete="email" maxLength={254} value={v.email} onChange={set('email')} />
        <Field label="Mobile phone" type="tel" required autoComplete="tel" inputMode="tel" minLength={10} maxLength={30}
          hint="We use this only to coordinate your volunteer work." value={v.phone} onChange={set('phone')} />
        <PasswordField label="Password" required autoComplete="new-password" minLength={8} maxLength={72}
          error={pwErr} hint="At least 8 characters." value={v.password} onChange={set('password')} />
        <PasswordField label="Confirm password" required autoComplete="new-password" minLength={8} maxLength={72}
          error={matchErr} value={v.confirmPassword} onChange={set('confirmPassword')} />
        <SubmitButton busy={busy} busyText="Creating your account">Create account</SubmitButton>
      </form>
      <p className="mt-6 text-sm">Already volunteering with us? <Link href="/signin" className="font-bold text-teal-text underline underline-offset-4">Sign in</Link></p>
    </PublicLayout>
  );
}

export default function Signup() { return <PublicAuthGate><Form /></PublicAuthGate>; }
