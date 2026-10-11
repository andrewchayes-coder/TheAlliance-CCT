import { useState } from 'react';
import { useLocation } from 'wouter';
import { PublicLayout, Button, StatusBadge } from '@/components/brand-system';
import { RequireVerified } from '@/auth/guards';
import { Notice } from '@/auth/auth-ui';
import { useAuth, readError } from '@/auth/auth-context';
import type { Me } from '@workspace/api-client-react';

const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'long' }) : null;
const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function Landing({ me, mode }: { me: Me; mode: 'dashboard' }) {
  const auth = useAuth();
  const [, nav] = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = me.profile;
  async function out() {
    setBusy(true); setErr(null);
    try { await auth.signout(); nav('/'); } catch (e) { setErr(readError(e).message); setBusy(false); }
  }
  const rows: { name: string; value: string; good: boolean }[] = [
    { name: 'Email verified', value: fmt(me.user.emailVerifiedAt) ?? 'Verified', good: true },
    { name: 'Resource Coordinator status', value: p ? label(p.status) : 'Not started', good: p?.status === 'active' },
    { name: 'Onboarding', value: p?.onboardingCompletedAt ? `Completed ${fmt(p.onboardingCompletedAt)}` : 'Not completed yet', good: !!p?.onboardingCompletedAt },
  ];
  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-3xl px-4 py-10 md:py-14">
        <p className="alliance-label">Your account</p>
        <h1 className="alliance-display mt-3 text-navy">
          Hello, {me.user.firstName}
        </h1>
        <p className="mt-3">
          {`Thank you for helping local families find the support they need. ${p ? `Serving ${p.county} County.` : ''}`}
        </p>
        {err && <div className="mt-5"><Notice>{err}</Notice></div>}
        <ul className="mt-8 divide-y divide-gray rounded-2xl border border-gray" aria-label="Account checkpoints">
          {rows.map(r => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="font-bold">{r.name}</span>
              <StatusBadge status={r.good ? 'good' : 'neutral'}>{r.value}</StatusBadge>
            </li>
          ))}
        </ul>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="alliance-label">Name</dt><dd className="mt-1">{me.user.firstName} {me.user.lastName}</dd></div>
          <div><dt className="alliance-label">Email</dt><dd className="mt-1 break-all">{me.user.email}</dd></div>
        </dl>
        <div className="mt-8 border-t border-gray pt-6">
          <Button variant="secondary" onClick={out} disabled={busy}>{busy ? 'Signing out' : 'Sign out'}</Button>
        </div>
      </div>
    </PublicLayout>
  );
}

export const Dashboard = () => <RequireVerified>{me => <Landing me={me} mode="dashboard" />}</RequireVerified>;
