import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { Input, PublicLayout } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/brand-system';
import { useAuth } from './auth-context';

export function AuthHeading({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <p className="alliance-label">{label}</p>
      <h1 className="alliance-display mt-3 text-navy">{title}</h1>
      {children && <p className="mt-3">{children}</p>}
    </header>
  );
}

export function Notice({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const style = kind === 'error'
    ? 'bg-[var(--alliance-red)] text-[var(--alliance-red-ink)]'
    : kind === 'info' ? 'bg-[var(--alliance-amber)] text-[var(--alliance-amber-ink)]' : 'bg-gray text-navy';
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-5 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${style}`}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string };

export function Field({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId();
  const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">{label}</label>
      <Input id={id} aria-invalid={!!error} aria-describedby={desc} {...props} />
      {error ? <p id={`${id}-e`} className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{error}</p>
        : hint ? <p id={`${id}-h`} className="mt-1.5 text-sm text-navy-soft">{hint}</p> : null}
    </div>
  );
}

export function PasswordField({ label, ...props }: FieldProps) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className={props.className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">{label}</label>
      <div className="relative">
        <Input id={id} type={show ? 'text' : 'password'} className="pr-12" aria-invalid={!!props.error}
          aria-describedby={props.error ? `${id}-e` : props.hint ? `${id}-h` : undefined}
          {...{ ...props, label: undefined, error: undefined, hint: undefined, className: undefined } as InputHTMLAttributes<HTMLInputElement>} />
        <button type="button" onClick={() => setShow(s => !s)} aria-pressed={show}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-navy focus-visible:outline-2 focus-visible:outline-blue">
          {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {props.error ? <p id={`${id}-e`} className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{props.error}</p>
        : props.hint ? <p id={`${id}-h`} className="mt-1.5 text-sm text-navy-soft">{props.hint}</p> : null}
    </div>
  );
}

export function SubmitButton({ busy, children, busyText }: { busy: boolean; children: ReactNode; busyText: string }) {
  return <Button type="submit" disabled={busy} className="w-full">{busy ? busyText : children}</Button>;
}

export function AuthLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <PublicLayout>
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{label}</span>
        <Skeleton className="h-4 w-28" /><Skeleton className="mt-4 h-8 w-3/4" /><Skeleton className="mt-6 h-11 w-full" />
      </div>
    </PublicLayout>
  );
}

export function SessionFailed() {
  const { retrySession } = useAuth();
  return (
    <PublicLayout>
      <AuthHeading label="Connection problem" title="We couldn't reach the portal" >
        Check your connection and try again.
      </AuthHeading>
      <Button onClick={retrySession}>Try again</Button>
    </PublicLayout>
  );
}

/** Redirect signed-in visitors away from entry pages using the server's nextPath. */
export function useRedirectIfAuthed(verifiedOnly = false): boolean {
  const { session } = useAuth();
  const [loc, nav] = useLocation();
  const target = session?.authenticated && (!verifiedOnly || session.verified) ? session.nextPath : null;
  useEffect(() => { if (target && target !== loc) nav(target, { replace: true }); }, [target, loc, nav]);
  return !!target && target !== loc;
}

/** Wrapper for public auth pages: handles session loading/error and authed redirect. */
export function PublicAuthGate({ children, allowAuthed = false, verifiedOnly = false }: { children: ReactNode; allowAuthed?: boolean; verifiedOnly?: boolean }) {
  const { session, sessionLoading, sessionError } = useAuth();
  const redirecting = useRedirectIfAuthed(verifiedOnly);
  if (sessionLoading) return <AuthLoading />;
  if (!session && sessionError) return <SessionFailed />;
  if (!allowAuthed && redirecting) return <AuthLoading label="Taking you to your account" />;
  return <>{children}</>;
}
