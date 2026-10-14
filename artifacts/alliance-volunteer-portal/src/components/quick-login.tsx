import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useGetQuickLoginStatus, getGetQuickLoginStatusQueryKey, useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';
import { testPersonaLabel as personaLabel } from '@workspace/shared/testAccounts';

function useStatus(enabled = true) {
  const q = useGetQuickLoginStatus({ query: { queryKey: getGetQuickLoginStatusQueryKey(), enabled, retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always' }, request: FETCH_CREDS });
  const data = q.isError || q.isPending ? undefined : q.data;
  return data && data.enabled && data.personas.length ? data : null;
}

function useSwitcher() {
  const auth = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(key: string) {
    if (pending) return;
    setPending(key); setError(null);
    try {
      const r = await auth.quickLogin({ persona: key });
      window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${r.nextPath || '/dashboard'}`);
    } catch (e) { setError(readError(e).message); }
    finally { setPending(null); }
  }
  return { pending, error, go };
}

export function QuickLoginCard() {
  const status = useStatus();
  const { pending, error, go } = useSwitcher();
  if (!status) return null;
  const prod = status.production ?? import.meta.env.PROD;
  return (
    <section aria-labelledby="ql-title" data-testid="card-quick-login" className="mt-6 w-full max-w-xl rounded-xl border-[1.5px] border-dashed border-amber-500 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ql-title" className="alliance-label">Quick login — testing</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Test accounts</span>
        {prod && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-900" data-testid="pill-production">Production</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-semibold">{error}</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {status.personas.map(p => (
          <button key={p.key} type="button" disabled={!!pending} onClick={() => { void go(p.key); }} data-testid={`button-quick-${p.key}`}
            className="flex min-h-11 items-center justify-between gap-2 rounded-lg border-[1.5px] border-blue bg-white px-4 py-3 text-left text-[15px] text-blue hover:bg-blue hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-50"
            aria-busy={pending === p.key}>
             <span className="min-w-0"><span className="block font-bold">{personaLabel(p.key, p.label)}</span><span className="block truncate text-sm" title={p.description}>{p.description}</span></span>
            {pending === p.key && <Loader2 className="shrink-0 animate-spin" size={18} aria-label="Signing in" />}
          </button>
        ))}
      </div>
    </section>
  );
}

export function TestAccountBanner() {
  const auth = useAuth();
  const ok = !!auth.session?.authenticated && auth.session.verified;
  const me = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: ok, staleTime: FRESH_MS, retry: false }, request: FETCH_CREDS });
  const user = me.data?.user;
  const persona = me.data?.testPersona;
  const status = useStatus(ok && !!user?.isTestAccount);
  const { pending, error, go } = useSwitcher();
  const [out, setOut] = useState(false);
  if (!ok || !user?.isTestAccount) return null;
  const personas = status?.personas ?? [];
  const current = personas.find(p => p.key === persona);
  const fallback = user.role === 'admin' ? 'Admin' : `Volunteer · ${me.data?.profile?.status === 'inactive' ? 'Inactive' : me.data?.profile?.status === 'active' ? 'Active' : 'Onboarding'}`;
  const label = persona ? personaLabel(persona, current?.label ?? fallback) : fallback;
  const others = personas.filter(p => p.key !== persona);
  async function signout() {
    setOut(true);
    await auth.signoutAndRedirect();
  }
  return (
    <div className="bg-amber-100 text-amber-950" data-testid="banner-test-account">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-sm md:px-6">
        <p className="min-w-0 basis-full sm:flex-1 sm:basis-auto" role="status">You're signed in as a TEST account ({label}). Emails to this account are not sent.</p>
        {error && <span role="alert" className="font-semibold">{error}</span>}
        {others.length > 0 && (
          <details className="relative" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector<HTMLElement>('summary')?.focus(); } }}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center font-bold underline underline-offset-4" data-testid="button-switch-account">Switch account</summary>
            <ul aria-label="Switch account" className="absolute left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-2 text-navy shadow-lg sm:left-auto sm:right-0">
              {others.map(p => (
                <li key={p.key}><button type="button" disabled={!!pending || out} onClick={() => { void go(p.key); }} data-testid={`button-switch-${p.key}`}
                   className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left font-bold hover:bg-gray focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-50">{personaLabel(p.key, p.label)}{pending === p.key && <Loader2 className="animate-spin" size={16} aria-hidden="true" />}</button></li>
              ))}
            </ul>
          </details>
        )}
        <button type="button" onClick={() => { void signout(); }} disabled={out || !!pending} data-testid="link-banner-signout" className="min-h-11 font-bold underline underline-offset-4 disabled:opacity-50">Sign out</button>
      </div>
    </div>
  );
}
