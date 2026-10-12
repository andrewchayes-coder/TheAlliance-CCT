import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetNotificationSummaryQueryKey, useSendProviderTestEmail, useUpdateNotificationLimit,
  type TestReminderResult,
} from '@workspace/api-client-react';
import { Button, Card, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { TYPES, countOf, monthName, type Summary } from './shared';

export function UsageCard({ s }: { s: Summary }) {
  const qc = useQueryClient();
  const auth = useAuth();
  const save = useUpdateNotificationLimit({ request: auth.request });
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const value = draft ?? String(s.monthlyLimit);
  const pct = s.percent;
  const tone = pct >= 95 ? '#a8302a' : pct >= 80 ? '#c9962b' : '#0175aa';
  const status = pct >= 95 ? 'blocked' : pct >= 80 ? 'attention' : 'good';
  const over = s.total - s.monthlyLimit;

  async function submit() {
    const n = Number(value);
    if (!/^\d+$/.test(value.trim()) || !Number.isInteger(n) || n < 1 || n > 1000000) { setErr('Enter a whole number from 1 to 1,000,000.'); return; }
    setErr(null); setOk(false);
    try {
      await save.mutateAsync({ data: { monthlyLimit: n } });
      setDraft(null); setOk(true);
      void qc.invalidateQueries({ queryKey: getGetNotificationSummaryQueryKey() });
    } catch (e) { setErr(readError(e).message); }
  }
  return (
    <Card className="p-4" data-testid="card-usage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="alliance-display">{monthName(s.month, true)} usage</h2>
        <StatusBadge status={status}>{pct >= 95 ? 'At limit' : pct >= 80 ? 'Approaching limit' : 'Within limit'}</StatusBadge>
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums" data-testid="text-total">{s.total.toLocaleString()} <span className="text-base font-semibold">of {s.monthlyLimit.toLocaleString()} emails</span></p>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-gray" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(pct))} aria-label="Share of monthly limit used">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone }} />
      </div>
      <p className="mt-1 text-sm" data-testid="text-percent">{pct.toFixed(1)}% of the limit{over > 0 ? `. Over the limit by ${over.toLocaleString()}.` : '.'}</p>
      <p className="mt-2 text-xs text-navy-soft">Counts every logged and sent email, including tests and alerts. This is not the provider's billing count. The limit only monitors: it never blocks mail. Active admins are emailed once when usage crosses 80%.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TYPES.map(t => <div key={t.type} className="rounded-lg bg-gray px-3 py-2"><dt className="flex items-center gap-1 text-xs font-bold"><span className="size-2.5 rounded-sm" style={{ background: t.color }} />{t.label}</dt><dd className="text-lg font-bold tabular-nums" data-testid={`text-type-${t.type}`}>{countOf(s.byType, t.type)}</dd></div>)}
      </dl>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <label className="text-sm font-bold">Monthly limit
          <input value={value} onChange={e => { setDraft(e.target.value); setOk(false); }} inputMode="numeric" data-testid="input-limit"
            className="alliance-input mt-1 block w-40 tabular-nums" aria-invalid={!!err} />
        </label>
        <Button type="submit" disabled={save.isPending || draft === null} data-testid="button-save-limit">{save.isPending ? 'Saving' : 'Save limit'}</Button>
        {draft !== null && <Button type="button" variant="secondary" onClick={() => { setDraft(null); setErr(null); }} data-testid="button-reset-limit">Discard</Button>}
      </form>
      <div className="mt-2">{err && <Notice>{err}</Notice>}{ok && <Notice kind="success">Limit saved.</Notice>}</div>
    </Card>
  );
}

export function ProviderCard({ s, onDone }: { s: Summary; onDone: () => void }) {
  const auth = useAuth();
  const test = useSendProviderTestEmail({ request: auth.request });
  const lock = useRef(false);
  const rid = useRef<string>(crypto.randomUUID());
  const [res, setRes] = useState<TestReminderResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const p = s.postmark;

  async function send() {
    if (lock.current) return;
    lock.current = true; setErr(null); setRes(null);
    try { setRes(await test.mutateAsync({ data: { requestId: rid.current } })); rid.current = crypto.randomUUID(); setRetrying(false); }
    catch (e) {
      const f = readError(e);
      if (f.status !== undefined && f.status >= 400 && f.status < 500) { rid.current = crypto.randomUUID(); setRetrying(false); setErr(f.message); }
      else { setRetrying(true); setErr(`${f.message} The result is uncertain. Retrying reuses the same request ID, so it will not send a duplicate.`); }
    } finally { lock.current = false; onDone(); }
  }
  const msg = res ? (res.status === 'sent' ? 'Sent to your signed-in admin email.' : res.status === 'logged' ? 'Logged only. It was not delivered to an inbox.' : res.status === 'suppressed' ? 'Not sent: emails to test accounts are suppressed.' : 'Failed to send.') : '';
  return (
    <Card className="p-4" data-testid="card-provider">
      <h2 className="alliance-display">Email provider</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><dt>Postmark token</dt><dd><StatusBadge status={p.tokenConfigured ? 'good' : 'attention'}>{p.tokenConfigured ? 'Configured' : 'Not configured'}</StatusBadge></dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>From name</dt><dd className="break-all font-bold" data-testid="text-email-from-name">{p.fromName ?? 'Not configured'}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>From address</dt><dd className="break-all font-bold" data-testid="text-email-from">{p.fromAddress ?? 'Not configured'}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>Reply-To</dt><dd className="break-all font-bold" data-testid="text-email-reply-to">{p.replyTo ?? 'Not configured'}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>Delivery</dt><dd><StatusBadge status={p.deliveryEnabled ? 'good' : 'neutral'}>{p.deliveryEnabled ? 'Enabled' : 'Log only'}</StatusBadge></dd></div>
      </dl>
      <p className="mt-3 text-sm">Before sending, the defendingthecause.org DKIM and Return-Path records must show Verified in Postmark.</p>
      <Button className="mt-3" type="button" onClick={() => { void send(); }} disabled={test.isPending} data-testid="button-send-provider-test">{test.isPending ? 'Sending test' : 'Send test email to me'}</Button>
      <p className="mt-2 text-xs text-navy-soft">Goes only to the signed-in admin's email. The address cannot be changed.{retrying ? ' Next click retries the previous request.' : ''}</p>
      <div aria-live="polite" className="mt-2 break-words">
        {res && <Notice kind={res.ok && res.status !== 'failed' ? 'success' : 'error'}>{res.skipped ? 'Skipped. ' : ''}{msg}{res.error ? ` ${res.error}` : ''}</Notice>}
        {err && <Notice>{err}</Notice>}
      </div>
    </Card>
  );
}
