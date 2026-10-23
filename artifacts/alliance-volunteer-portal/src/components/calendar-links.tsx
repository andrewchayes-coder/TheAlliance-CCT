import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetVolunteerCalendarQueryKey, useGetVolunteerCalendar, useResetVolunteerCalendar, type VolunteerCalendar,
} from '@workspace/api-client-react';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { Notice } from '@/auth/auth-ui';
import { ShiftModal } from '@/components/shift-modal';

export function useCalendar(enabled: boolean) {
  return useGetVolunteerCalendar({
    query: { queryKey: getGetVolunteerCalendarQueryKey(), enabled, staleTime: 30_000 }, request: FETCH_CREDS,
  });
}

const CLIENTS = { google: 'Google Calendar', microsoft: 'Outlook', apple: 'Apple Calendar', other: 'a calendar app' } as const;

export function calendarStatusText(c: Pick<VolunteerCalendar, 'lastFetchedAt' | 'lastClient'>): string {
  if (!c.lastFetchedAt) return 'Not added to a calendar yet.';
  const t = new Date(c.lastFetchedAt).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  const ago = mins < 2 ? 'just now' : mins < 60 ? `${mins} minutes ago` : mins < 1440
    ? `${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? 'hour' : 'hours'} ago`
    : `${Math.round(mins / 1440)} ${Math.round(mins / 1440) === 1 ? 'day' : 'days'} ago`;
  return `Connected to ${CLIENTS[c.lastClient ?? 'other']}. Last checked ${ago}.`;
}

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
const btn = 'alliance-button alliance-button-secondary text-center';

export function CalendarButtons({ cal }: { cal: VolunteerCalendar }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (manual) field.current?.select(); }, [manual]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(cal.feedUrl);
      setCopied(true); setManual(false);
      window.setTimeout(() => setCopied(false), 4000);
    } catch { setManual(true); }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <a href={cal.links.google} {...ext} className={btn} data-testid="button-calendar-google">Google Calendar<span className="sr-only"> (opens in a new tab)</span></a>
        <a href={cal.links.outlook} {...ext} className={btn} data-testid="button-calendar-outlook">Outlook.com<span className="sr-only"> (opens in a new tab)</span></a>
        <a href={cal.links.office365} {...ext} className={btn} data-testid="button-calendar-office365">Outlook (work or school)<span className="sr-only"> (opens in a new tab)</span></a>
        <a href={cal.links.apple} className={btn} data-testid="button-calendar-apple">Apple Calendar (iPhone, iPad, Mac)</a>
        <button type="button" onClick={() => { void copy(); }} className={btn} data-testid="button-calendar-copy">Copy link</button>
      </div>
      {copied && <p role="status" className="mt-2 text-sm font-bold" data-testid="text-calendar-copied">Link copied</p>}
      {manual && (
        <div className="mt-2">
          <label htmlFor="calendar-feed-url" className="text-sm">Copy this link</label>
          <input id="calendar-feed-url" ref={field} readOnly value={cal.feedUrl} className="alliance-input mt-1" data-testid="input-calendar-url" onFocus={e => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}

export function CalendarCard() {
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useCalendar(true);
  const reset = useResetVolunteerCalendar({ request: auth.request });
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const focusCalendar = () => {
      if (window.location.hash !== '#calendar') return;
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    focusCalendar();
    window.addEventListener('hashchange', focusCalendar);
    return () => window.removeEventListener('hashchange', focusCalendar);
  }, []);

  async function doReset() {
    setErr(null);
    try {
      const r = await reset.mutateAsync();
      qc.setQueryData(getGetVolunteerCalendarQueryKey(), r);
      void qc.invalidateQueries({ queryKey: getGetVolunteerCalendarQueryKey() });
      setConfirm(false); setDone(true);
    } catch (e) { setErr(readError(e, "We couldn't reset your link. Please try again.").message); }
  }
  const cal = q.data;
  return (
    <section id="calendar" aria-labelledby="calendar-h" className="scroll-mt-6 rounded-2xl bg-white p-5 shadow-sm" data-testid="card-calendar">
      <h2 id="calendar-h" ref={heading} tabIndex={-1} className="alliance-section-kicker">Add your shifts to your calendar</h2>
      {q.isPending ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-gray" role="status"><span className="sr-only">Loading</span></div>
        : !cal ? <p className="mt-3 text-sm">We couldn't load your calendar link. <button type="button" className="font-bold underline" onClick={() => { void q.refetch(); }}>Try again</button></p> : (
          <>
            <p className="mt-2 text-sm">Your shifts can show up in the calendar you already use, and they update on their own when you change a shift, take a week off or pick up a one-time shift. Choose your calendar:</p>
            <div className="mt-3"><CalendarButtons cal={cal} /></div>
            <p className="mt-3 text-sm">Changes reach your calendar automatically, usually within a few hours (Google can take up to a day). This page and your reminder emails are always up to date. Using an Android phone? Add it to Google Calendar once from a computer, and it will show on your phone.</p>
            <p className="mt-3 text-sm font-bold" data-testid="text-calendar-status">{calendarStatusText(cal)}</p>
            {done && <p role="status" className="mt-2 text-sm font-bold" data-testid="text-calendar-reset-done">Your calendar link was reset. Add your shifts to your calendar again.</p>}
            <p className="mt-3 text-sm">Keep this link to yourself: anyone who has it can see your shift times.{' '}
              <button type="button" className="font-bold text-blue underline underline-offset-4" onClick={() => { setErr(null); setConfirm(true); }} data-testid="button-calendar-reset">Reset my calendar link</button></p>
          </>
        )}
      {confirm && (
        <ShiftModal title="Reset your calendar link?" busy={reset.isPending} onClose={() => setConfirm(false)}
          description="Calendars using your current link will stop updating, and the shifts already in them won't change. Afterwards, add your shifts to your calendar again."
          footer={<>
            <button type="button" className="alliance-button alliance-button-secondary" disabled={reset.isPending} onClick={() => setConfirm(false)} data-testid="button-calendar-reset-cancel">Cancel</button>
            <button type="button" className="alliance-button alliance-button-primary" disabled={reset.isPending} onClick={() => { void doReset(); }} data-testid="button-calendar-reset-confirm">Reset link</button>
          </>}>
          {err && <Notice>{err}</Notice>}
        </ShiftModal>
      )}
    </section>
  );
}

export function CalendarConfirmRow() {
  const q = useCalendar(true);
  const [more, setMore] = useState(false);
  const cal = q.data;
  if (!cal) return null;
  const connected = !!cal.lastFetchedAt;
  return (
    <div className="mt-5 rounded-xl bg-white p-4 text-navy" data-testid="section-confirm-calendar">
      {connected ? (
        <>
          <p className="text-sm">Your calendar is connected and will pick this up automatically (usually within a few hours).</p>
          <button type="button" className="mt-2 font-bold text-blue underline underline-offset-4" aria-expanded={more} onClick={() => setMore(m => !m)} data-testid="button-calendar-another">Add to another calendar</button>
          {more && <div className="mt-3"><CalendarButtons cal={cal} /></div>}
        </>
      ) : (
        <>
          <h3 className="text-base">Add to your calendar</h3>
          <div className="mt-2"><CalendarButtons cal={cal} /></div>
        </>
      )}
    </div>
  );
}

export function HomeCalendarLink({ href }: { href: string }) {
  const q = useCalendar(true);
  if (!q.data || q.data.lastFetchedAt) return null;
  return (
    <a href={href} className="font-bold text-blue underline underline-offset-4 lg:col-span-2" data-testid="link-home-calendar">Add your shifts to your calendar</a>
  );
}
