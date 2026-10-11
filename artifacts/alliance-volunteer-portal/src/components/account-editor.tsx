import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card } from '@/components/brand-system';
import { Field, Notice, PasswordField } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { accountPhotoUrl, useAccountProfile } from '@/lib/account-client';
import { formatPhone } from '@workspace/shared/profileFields';
import { Skeleton } from '@/components/ui/skeleton';

type Msg = { kind: 'error' | 'success' | 'info'; text: string } | null;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : readError(e, fallback).message);
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function Section({ id, title, intro, msg, children }: { id: string; title: string; intro?: string; msg: Msg; children: React.ReactNode }) {
  return (
    <Card aria-labelledby={id}>
      <h2 id={id} className="alliance-display">{title}</h2>
      {intro && <p className="mt-2 text-sm">{intro}</p>}
      <div className="mt-3" aria-live="polite">{msg && <Notice kind={msg.kind}>{msg.text}</Notice>}</div>
      {children}
    </Card>
  );
}

function PasswordSection() {
  const auth = useAuth();
  const [f, setF] = useState({ currentPassword: '', password: '', confirmPassword: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!f.currentPassword) x.currentPassword = 'Enter your current password';
    if (f.password.length < 8) x.password = 'Use at least 8 characters';
    else if (new TextEncoder().encode(f.password).length > 72) x.password = 'This password is too long. Try a shorter password with at least 8 characters.';
    if (f.confirmPassword !== f.password) x.confirmPassword = 'Passwords do not match';
    setErr(x);
    if (Object.keys(x).length) return;
    setBusy(true);
    try {
      const headers = new Headers(auth.request.headers);
      headers.set('Content-Type', 'application/json');
      const r = await fetch(`${base}/api/account/password`, { ...auth.request, method: 'POST', headers, cache: 'no-store', body: JSON.stringify(f) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        const text = d.error ?? "We couldn't change your password.";
        setErr(r.status === 400 && /current password/i.test(text) ? { currentPassword: text } : { form: text });
        setBusy(false);
        return;
      }
      setF({ currentPassword: '', password: '', confirmPassword: '' });
      // Fresh page load drops the whole authenticated client after session revocation.
      window.location.assign(`${base}/signin?password-changed=1`);
    } catch { setErr({ form: "We couldn't change your password. Check your connection and try again." }); setBusy(false); }
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

/** Account editor for one user. `managed` = an admin editing someone else. Keep keyed by userId at call sites. */
export function AccountEditor({ userId, managed = false, showDetails = true }: { userId: string; managed?: boolean; showDetails?: boolean }) {
  const acct = useAccountProfile(userId, managed);
  const { save, email, cancelEmail, upload, removePhoto, resetPassword } = acct;
  const u = acct.data?.user;
  const [first, setFirst] = useState(''); const [last, setLast] = useState(''); const [phone, setPhone] = useState('');
  const [newEmail, setNewEmail] = useState(''); const [pw, setPw] = useState('');
  const [dMsg, setDMsg] = useState<Msg>(null); const [eMsg, setEMsg] = useState<Msg>(null);
  const [pMsg, setPMsg] = useState<Msg>(null); const [rMsg, setRMsg] = useState<Msg>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const sv = u ? `${u.firstName}\u0000${u.lastName}\u0000${u.phone ?? ''}` : '';
  useEffect(() => {
    if (!u) return;
    setFirst(u.firstName); setLast(u.lastName); setPhone(formatPhone(u.phone) || u.phone || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv]);

  if (acct.isLoading) return <div className="grid gap-3" role="status" aria-busy="true"><span className="sr-only">Loading account</span><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (acct.isError || !acct.data || !u) {
    return <Card><Notice>{errText(acct.error, "We couldn't load the account details.")}</Notice><Button variant="secondary" onClick={() => { void acct.refetch(); }} data-testid="button-retry-account">Try again</Button></Card>;
  }
  const d = acct.data;
  const who = managed ? `${u.firstName}'s` : 'your';

  async function saveDetails(e: FormEvent) {
    e.preventDefault(); setDMsg(null);
    if (!first.trim() || !last.trim()) { setDMsg({ kind: 'error', text: 'First and last name are required.' }); return; }
    try {
      await save.mutateAsync({ firstName: first.trim(), lastName: last.trim(), phone: phone.trim() || null });
      setDMsg({ kind: 'success', text: 'Name and phone saved. Your email address was not changed.' });
    } catch (ex) { setDMsg({ kind: 'error', text: errText(ex, "We couldn't save these details.") }); }
  }
  async function changeEmail(e: FormEvent) {
    e.preventDefault(); setEMsg(null);
    if (!newEmail.trim()) { setEMsg({ kind: 'error', text: 'Enter the new email address.' }); return; }
    if (!managed && !pw) { setEMsg({ kind: 'error', text: 'Enter your current password to change your email.' }); return; }
    try {
      const r = await email.mutateAsync({ email: newEmail.trim(), ...(managed ? {} : { currentPassword: pw }) });
      setNewEmail(''); setPw('');
      setEMsg({ kind: r.deliveryFailed ? 'error' : 'info', text: r.message ?? `We sent a verification link to ${r.pendingEmail ?? 'the new address'}. The email on file stays the same until it is verified.` });
    } catch (ex) { setEMsg({ kind: 'error', text: errText(ex, "We couldn't start the email change.") }); }
  }
  async function cancelChange() {
    setEMsg(null);
    try { await cancelEmail.mutateAsync(); setEMsg({ kind: 'success', text: 'Pending email change canceled.' }); }
    catch (ex) { setEMsg({ kind: 'error', text: errText(ex, "We couldn't cancel the change.") }); }
  }
  async function pick(f: File | undefined) {
    setPMsg(null);
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { setPMsg({ kind: 'error', text: 'Choose a PNG, JPEG, or WebP image.' }); return; }
    if (f.size > 3 * 1024 * 1024) { setPMsg({ kind: 'error', text: 'That image is larger than 3 MB. Choose a smaller one.' }); return; }
    try { await upload.mutateAsync(f); setPMsg({ kind: 'success', text: 'Photo saved.' }); }
    catch (ex) { setPMsg({ kind: 'error', text: errText(ex, "We couldn't upload that photo.") }); }
    if (file.current) file.current.value = '';
  }
  async function removeIt() {
    setPMsg(null); setConfirmRemove(false);
    try { await removePhoto.mutateAsync(); setPMsg({ kind: 'success', text: 'Photo removed.' }); }
    catch (ex) { setPMsg({ kind: 'error', text: errText(ex, "We couldn't remove the photo.") }); }
  }
  async function reset() {
    setRMsg(null);
    try {
      const r = await resetPassword.mutateAsync();
      setRMsg({ kind: r.deliveryFailed ? 'error' : 'success', text: r.message });
    } catch (ex) { setRMsg({ kind: 'error', text: errText(ex, "We couldn't send the reset.") }); }
  }
  const photoBusy = upload.isPending || removePhoto.isPending;
  const initials = `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase();
  const pendingDate = d.pendingEmailExpiresAt ? new Date(d.pendingEmailExpiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <div className="grid gap-6" data-testid={`account-editor-${userId}`}>
      <Section id={`ph-${userId}`} title="Photo" intro="PNG, JPEG, or WebP, up to 3 MB." msg={pMsg}>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {d.photoUrl
            ? <img key={d.photoUrl} src={accountPhotoUrl(d.photoUrl)} alt={`Photo of ${u.firstName} ${u.lastName}`} className="size-24 rounded-full border-[1.5px] border-navy object-cover" data-testid="img-account-photo" />
            : <div className="flex size-24 items-center justify-center rounded-full border-[1.5px] border-navy bg-gray text-2xl font-bold" aria-hidden="true">{initials}</div>}
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose photo file" onChange={e => { void pick(e.target.files?.[0]); }} data-testid="input-photo" />
            <Button type="button" variant="secondary" disabled={photoBusy} onClick={() => file.current?.click()} data-testid="button-upload-photo">{upload.isPending ? 'Uploading' : d.photoUrl ? 'Replace photo' : 'Upload photo'}</Button>
            {d.photoUrl && (confirmRemove
              ? <><Button type="button" disabled={photoBusy} onClick={() => { void removeIt(); }} data-testid="button-confirm-remove-photo">Yes, remove photo</Button>
                  <Button type="button" variant="secondary" onClick={() => setConfirmRemove(false)}>Keep photo</Button></>
              : <Button type="button" variant="secondary" disabled={photoBusy} onClick={() => setConfirmRemove(true)} data-testid="button-remove-photo">{removePhoto.isPending ? 'Removing' : 'Remove photo'}</Button>)}
          </div>
        </div>
      </Section>

      {showDetails && (
        <Section id={`dt-${userId}`} title="Name and phone" msg={dMsg}>
          <form noValidate onSubmit={e => { void saveDetails(e); }} className="mt-2 grid gap-4 sm:grid-cols-2" data-testid="form-account-details">
            <fieldset disabled={save.isPending} className="contents">
              <Field label="First name" required maxLength={100} autoComplete="given-name" value={first} onChange={e => setFirst(e.target.value)} data-testid="input-account-first" />
              <Field label="Last name" required maxLength={100} autoComplete="family-name" value={last} onChange={e => setLast(e.target.value)} data-testid="input-account-last" />
              <Field className="sm:col-span-2" label="Phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} onBlur={() => setPhone(p => formatPhone(p) || p)} data-testid="input-account-phone" />
              <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending} data-testid="button-save-account">{save.isPending ? 'Saving' : 'Save name and phone'}</Button></div>
            </fieldset>
          </form>
        </Section>
      )}

      <Section id={`em-${userId}`} title="Email address" msg={eMsg}
        intro={`Current email: ${u.email}. A change only takes effect after the new address is verified; until then ${who} sign-in email stays the same.`}>
        {d.pendingEmail && (
          <div className="mt-3 rounded-lg bg-gray p-4 text-sm" data-testid="pending-email">
            <p className="font-bold">Waiting for verification: {d.pendingEmail}</p>
            <p className="mt-1">Use the verification link for that address{pendingDate ? ` before ${pendingDate}` : ''}. If it hasn’t arrived, request another link below. Until then {u.email} remains the sign-in email.</p>
            <Button type="button" variant="secondary" disabled={cancelEmail.isPending} onClick={() => { void cancelChange(); }} data-testid="button-cancel-email">{cancelEmail.isPending ? 'Canceling' : 'Cancel change'}</Button>
          </div>
        )}
        <form noValidate onSubmit={e => { void changeEmail(e); }} className="mt-3 grid gap-4" data-testid="form-account-email">
          <fieldset disabled={email.isPending} className="contents">
            <Field label="New email address" type="email" maxLength={254} autoComplete="off" value={newEmail} onChange={e => setNewEmail(e.target.value)} data-testid="input-account-email" />
            {!managed && <PasswordField label="Current password" autoComplete="current-password" hint="Required to change your email." value={pw} onChange={e => setPw(e.target.value)} data-testid="input-email-password" />}
            <div><Button type="submit" disabled={email.isPending} data-testid="button-change-email">{email.isPending ? 'Sending' : 'Send verification link'}</Button></div>
          </fieldset>
        </form>
      </Section>

      {managed && (
        <Section id={`rs-${userId}`} title="Reset access" msg={rMsg} intro={`Send ${u.firstName} a password reset link. Their current password keeps working until they use it. Test environments may suppress the message.`}>
          <Button type="button" variant="secondary" disabled={resetPassword.isPending} onClick={() => { void reset(); }} data-testid="button-send-reset">{resetPassword.isPending ? 'Sending' : 'Send password reset'}</Button>
        </Section>
      )}
      {!managed && <PasswordSection />}
    </div>
  );
}
