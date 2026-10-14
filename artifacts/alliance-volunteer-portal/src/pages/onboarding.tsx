import { ContactLink } from '@/components/shift-cards';
import { PageHeader } from '@/components/page-header';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { isProfileComplete } from '@/lib/profile-complete';
import { appConfig } from '@workspace/shared/appConfig';
import { formatPhone, phoneDigits, profileCompletionSchema, profileDraftSchema, requiredProfileFields } from '@workspace/shared/profileFields';
import { ProfileFields, type ProfileErrors, type ProfileKey, type ProfileValues } from '@/components/profile-fields';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import {
  getGetOnboardingAgreementQueryKey, getGetOnboardingAgreementsQueryKey, useGetOnboardingAgreement, useGetOnboardingAgreements, useSaveOnboarding, type Me,
} from '@workspace/api-client-react';
import {
  buildOnboardingAnswersSchema, onboardingQuestions, type OnboardingQuestion,
} from '@workspace/shared/onboardingQuestions';
import { PublicLayout, Button, EmptyState } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireVerified } from '@/auth/guards';
import { Field, Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';

type Answers = Record<string, unknown>;
type Errors = Record<string, string>;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const choiceClass = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-gray px-3.5 py-2.5 text-[15px] has-[:checked]:bg-[#d6e9f3] has-[:checked]:ring-2 has-[:checked]:ring-blue has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue';

export function QuestionField({ q, value, error, onChange }: { q: OnboardingQuestion; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const id = useId();
  const descId = `${id}-d`;
  const described = error || q.helpText ? descId : undefined;
  const str = typeof value === 'string' ? value : '';
  let control: ReactNode;
  if (q.type === 'text') control = <input id={id} className="alliance-input" value={str} maxLength={500} aria-invalid={!!error} aria-describedby={described} onChange={e => onChange(e.target.value)} />;
  else if (q.type === 'date') control = <input id={id} type="date" className="alliance-input" value={str} aria-invalid={!!error} aria-describedby={described} onChange={e => onChange(e.target.value)} />;
  else if (q.type === 'textarea') control = <textarea id={id} className="alliance-input min-h-28" value={str} maxLength={5000} aria-invalid={!!error} aria-describedby={described} onChange={e => onChange(e.target.value)} />;
  else if (q.type === 'select') control = (
    <select id={id} className="alliance-input" value={str} aria-invalid={!!error} aria-describedby={described} onChange={e => onChange(e.target.value)}>
      <option value="">Choose one</option>
      {q.options?.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (control) {
    return (
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-bold">{q.label}{q.required && <span className="text-blue"> (required)</span>}</label>
        {control}
        <FieldNote id={descId} error={error} help={q.helpText} />
      </div>
    );
  }
  // radio, yesno, multiselect: fieldset of native inputs
  const arr = Array.isArray(value) ? (value as string[]) : [];
  return (
    <fieldset aria-describedby={described} aria-invalid={!!error}>
      <legend className="mb-1.5 text-sm font-bold">{q.label}{q.required && <span className="text-blue"> (required)</span>}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.type === 'yesno' && [true, false].map(b => (
          <label key={String(b)} className={choiceClass}>
            <input type="radio" name={id} className="size-4 accent-[#0175aa]" checked={value === b} onChange={() => onChange(b)} />{b ? 'Yes' : 'No'}
          </label>
        ))}
        {q.type === 'radio' && q.options?.map(o => (
          <label key={o} className={choiceClass}>
            <input type="radio" name={id} className="size-4 accent-[#0175aa]" checked={str === o} onChange={() => onChange(o)} />{o}
          </label>
        ))}
        {q.type === 'multiselect' && q.options?.map(o => (
          <label key={o} className={choiceClass}>
            <input type="checkbox" className="size-4 accent-[#0175aa]" checked={arr.includes(o)}
              onChange={e => onChange(e.target.checked ? [...arr, o] : arr.filter(x => x !== o))} />{o}
          </label>
        ))}
      </div>
      <FieldNote id={descId} error={error} help={q.helpText} />
    </fieldset>
  );
}

function FieldNote({ id, error, help }: { id: string; error?: string; help?: string }) {
  if (error) return <p id={id} role="alert" className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{error}</p>;
  return help ? <p id={id} className="mt-1.5 text-sm text-navy-soft">{help}</p> : null;
}

function AgreementsBlock({ checked, onCheck, error, onReady }: { checked: boolean; onCheck: (v: boolean) => void; error?: string; onReady: (v: { ready: boolean; version: string }) => void }) {
  const q = useGetOnboardingAgreements({ query: { queryKey: getGetOnboardingAgreementsQueryKey(), staleTime: FRESH_MS, retry: false }, request: FETCH_CREDS });
  const d = q.data;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => { onReadyRef.current({ ready: !!d?.ready, version: d?.version ?? '' }); }, [d?.ready, d?.version]);
  return (
    <section className="rounded-2xl border border-gray p-5" aria-labelledby="agree-h">
      <h2 id="agree-h" className="alliance-display">Our agreements</h2>
      {q.isPending ? <Skeleton className="mt-4 h-24 w-full" /> : q.isError ? (
        <div className="mt-3"><Notice>Something went wrong on our end. Please try again. If it keeps happening, let <ContactLink /> know.</Notice><Button type="button" variant="secondary" onClick={() => { void q.refetch(); }}>Try again</Button></div>
      ) : d && (
        <>
          {!d.ready && <div className="mt-3"><Notice kind="info">The agreements aren't both available yet, so onboarding can't be finished today. Your progress is saved. Please check back soon.</Notice></div>}
          <ul className="mt-3 divide-y divide-gray">
            {d.resources.map(r => (
              <li key={r.id}>
                <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/onboarding/agreements/${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer" data-testid={`link-agreement-${r.id}`}
                  className="flex min-h-11 items-center gap-3 py-2 font-bold text-blue underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blue">
                  <FileText size={18} aria-hidden="true" />{r.title}<span className="sr-only"> (opens in a new tab)</span><ExternalLink size={14} aria-hidden="true" className="ml-auto" />
                </a>
              </li>
            ))}
          </ul>
          <label className={`${choiceClass} mt-4 ${d.ready ? '' : 'opacity-60'}`}>
            <input type="checkbox" className="size-5 shrink-0 accent-[#0175aa]" checked={checked} disabled={!d.ready} data-testid="checkbox-agreement" onChange={e => onCheck(e.target.checked)} />
            <span>I have read and agree to the Volunteer User Agreement and Safety Guidelines.</span>
          </label>
          {error && <p role="alert" className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{error}</p>}
        </>
      )}
    </section>
  );
}

const KEYS = Object.keys(requiredProfileFields) as ProfileKey[];
const NULLABLE = new Set<ProfileKey>(['dateOfBirth', 'addressLine1', 'city', 'state', 'zip', 'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone']);
const PHONES = new Set<ProfileKey>(['phone', 'emergencyContactPhone']);

function initial(me: Me): ProfileValues {
  const p = me.profile;
  return {
    firstName: me.user.firstName ?? '', lastName: me.user.lastName ?? '', phone: formatPhone(me.user.phone),
    dateOfBirth: p?.dateOfBirth ?? '', addressLine1: p?.addressLine1 ?? '', city: p?.city ?? '', state: p?.state || 'CA', zip: p?.zip ?? '',
    emergencyContactName: p?.emergencyContactName ?? '', emergencyContactRelationship: p?.emergencyContactRelationship ?? '',
    emergencyContactPhone: formatPhone(p?.emergencyContactPhone),
  };
}

function OnboardingForm({ me }: { me: Me }) {
  const auth = useAuth();
  const [, nav] = useLocation();
  const save = useSaveOnboarding({ request: auth.request });
  const mutateRef = useRef(save.mutateAsync);
  mutateRef.current = save.mutateAsync;

  const [values, setValues] = useState<ProfileValues>(() => initial(me));
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(me.profile?.onboardingAnswers ?? {}) }));
  const [errors, setErrors] = useState<ProfileErrors & Errors>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [finishing, setFinishing] = useState(false);
  const [outBusy, setOutBusy] = useState(false);

  const latest = useRef({ values, answers });
  latest.current = { values, answers };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastSent = useRef<Record<string, string>>({});
  const pending = useRef(0);
  const finalizing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const done = isProfileComplete(me);
  const dobLocked = !!me.profile?.onboardingCompletedAt && !!me.profile?.dateOfBirth;
  const [agreed, setAgreed] = useState(false);
  const [agr, setAgr] = useState({ ready: false, version: '' });
  useEffect(() => { if (done && !finalizing.current) nav('/dashboard', { replace: true }); }, [done, nav]);

  /** Serialized single-field draft save. Failures keep typed data in memory and surface a status. */
  const enqueue = useCallback((key: string, payload: Record<string, unknown>, sig: string) => {
    if (lastSent.current[key] === sig) return queue.current;
    pending.current += 1;
    if (mounted.current) setSaveState('saving');
    const p = queue.current.catch(() => undefined).then(async () => {
      try {
        await mutateRef.current({ data: { ...payload, complete: false } });
        lastSent.current[key] = sig;
        pending.current -= 1;
        if (mounted.current && pending.current === 0) setSaveState('saved');
      } catch {
        pending.current -= 1;
        if (mounted.current) setSaveState('error');
      }
    });
    queue.current = p;
    return p;
  }, []);

  const blurField = useCallback((k: ProfileKey) => {
    if (finalizing.current) return;
    let v = latest.current.values[k];
    if (PHONES.has(k) && v && phoneDigits(v).length <= 10) { v = formatPhone(v); setValues(x => ({ ...x, [k]: v })); }
    const trimmed = v.trim();
    if (trimmed) {
      const full = profileCompletionSchema.shape[k].safeParse(trimmed);
      setErrors(e => ({ ...e, [k]: full.success ? '' : full.error.issues[0]?.message ?? 'Check this field.' }));
    } else setErrors(e => ({ ...e, [k]: '' }));
    const value = NULLABLE.has(k) ? (trimmed || null) : trimmed;
    const r = profileDraftSchema.safeParse({ [k]: value });
    if (!r.success) return; // invalid so far; stays local, error shown above
    void enqueue(k, r.data as Record<string, unknown>, String(value));
  }, [enqueue]);

  const blurAnswers = useCallback(() => {
    if (finalizing.current || onboardingQuestions.length === 0) return;
    const a = buildOnboardingAnswersSchema({ draft: true }).safeParse(latest.current.answers);
    if (!a.success) return;
    void enqueue('answers', { answers: a.data }, JSON.stringify(a.data));
  }, [enqueue]);

  const setV = (k: ProfileKey, v: string) => { setValues(x => ({ ...x, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); setFormErr(null); };
  const setAnswer = (id: string, v: unknown) => { setAnswers(a => ({ ...a, [id]: v })); setErrors(e => ({ ...e, [id]: '' })); setFormErr(null); };

  async function finish() {
    setFormErr(null);
    if (finishing) return;
    const parsed = profileCompletionSchema.safeParse(latest.current.values);
    const ap = onboardingQuestions.length ? buildOnboardingAnswersSchema().safeParse(latest.current.answers) : null;
    if (!parsed.success || (ap && !ap.success)) {
      const errs: Errors = {};
      if (!parsed.success) for (const i of parsed.error.issues) { const k = String(i.path[0] ?? ''); if (k && !errs[k]) errs[k] = i.message; }
      if (ap && !ap.success) for (const i of ap.error.issues) { const k = String(i.path[0] ?? ''); if (k && !errs[k]) errs[k] = i.message; }
      setErrors(errs);
      setFormErr('A few details still need attention.');
      return;
    }
    if (appConfig.requireAgreementAcknowledgment) {
      if (!agr.ready) { setErrors(e => ({ ...e, agreement: 'Agreements are not available yet.' })); return; }
      if (!agreed) { setErrors(e => ({ ...e, agreement: 'Please confirm you agree to continue.' })); return; }
    }
    setFinishing(true);
    finalizing.current = true;
    try {
      await queue.current.catch(() => undefined); // flush pending blur saves first
      await mutateRef.current({ data: { ...parsed.data, ...(ap?.success ? { answers: ap.data } : {}), complete: true, ...(appConfig.requireAgreementAcknowledgment ? { agreementAcknowledged: true, agreementVersion: agr.version } : {}) } });
      await auth.refresh();
      nav('/dashboard', { replace: true });
    } catch (e) {
      finalizing.current = false;
      setFormErr(readError(e, "We couldn't finish your onboarding. Your details are safe; please try again.").message);
      setFinishing(false);
    }
  }

  async function out() {
    setOutBusy(true);
    await queue.current.catch(() => undefined);
    await auth.signoutAndRedirect();
  }

  const statusText = saveState === 'saving' ? 'Saving your progress…' : saveState === 'saved' ? 'Progress saved' : saveState === 'error' ? "Couldn't save yet. We'll try again when you move to the next field." : 'Your progress saves as you go.';
  void KEYS;

  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
        <PageHeader eyebrow="Onboarding" title={`Welcome, ${me.user.firstName}`} description="Welcome to the Community Care Team. A few details help us support you and reach someone if we ever need to." />
        <div className="mt-5">{formErr && <Notice>{formErr}</Notice>}</div>
        <form noValidate onSubmit={e => { e.preventDefault(); void finish(); }} className="mt-4 grid gap-8" data-testid="form-onboarding">
          <fieldset disabled={finishing || outBusy} className="contents">
            <ProfileFields values={values} errors={errors} email={me.user.email} onChange={setV} onBlur={blurField} dobReadOnly={dobLocked} />
            {appConfig.requireAgreementAcknowledgment && <AgreementsBlock checked={agreed} onCheck={v => { setAgreed(v); setErrors(e => ({ ...e, agreement: '' })); }} error={errors.agreement} onReady={setAgr} />}
            {onboardingQuestions.length > 0 && (
              <div className="grid gap-6" onBlur={blurAnswers}>
                {onboardingQuestions.map(q => <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={v => setAnswer(q.id, v)} />)}
              </div>
            )}
            <div className="flex flex-col gap-3 border-t border-gray pt-5 sm:flex-row sm:items-center">
              <Button type="submit" className="sm:ml-auto" disabled={finishing} data-testid="button-finish">{finishing ? 'Finishing' : 'Finish onboarding'}</Button>
            </div>
          </fieldset>
          <p role="status" className="text-sm text-navy-soft" data-testid="text-save-status">{statusText}</p>
        </form>
        <div className="mt-8 border-t border-gray pt-6">
          <Button variant="secondary" onClick={() => { void out(); }} disabled={outBusy || finishing} data-testid="button-signout">{outBusy ? 'Signing out' : 'Sign out'}</Button>
        </div>
      </div>
    </PublicLayout>
  );
}

export const Onboarding = () => <RequireVerified allowIncomplete>{me => <OnboardingForm key={me.user.id} me={me} />}</RequireVerified>;

function safeHref(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, window.location.origin);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

function AgreementBody() {
  const { resourceId = '' } = useParams<{ resourceId: string }>();
  const q = useGetOnboardingAgreement(resourceId, { query: { queryKey: getGetOnboardingAgreementQueryKey(resourceId), enabled: !!resourceId, retry: false }, request: FETCH_CREDS });
  const r = q.data;
  const href = safeHref(r?.href ?? null);
  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
        <Link href="/onboarding" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-blue underline underline-offset-4"><ArrowLeft size={16} aria-hidden="true" />Back to onboarding</Link>
        {q.isPending ? <div role="status" aria-busy="true"><span className="sr-only">Loading</span><Skeleton className="h-10 w-2/3" /><Skeleton className="mt-6 h-48 w-full" /></div>
          : q.isError || !r ? (
            <>
              <EmptyState title="We couldn't find that document" description="It may have been unpublished or moved. Return to onboarding and open it from the list again." />
              <Button variant="secondary" onClick={() => { void q.refetch(); }}>Try again</Button>
            </>
          ) : (
            <article>
              <PageHeader eyebrow={r.type === 'article' ? 'Article' : r.type === 'document' ? 'Document' : 'Link'} title={r.title} titleTestId="text-agreement-title" />
              {r.body && <div className="mt-5 whitespace-pre-wrap break-words" data-testid="text-agreement-body">{r.body}</div>}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="alliance-button alliance-button-primary mt-6" data-testid="link-agreement-open">
                  {r.type === 'link' ? 'Open link' : 'Open document'}<ExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              {!r.body && !href && <Notice kind="info">This resource has no readable content yet. Please contact <ContactLink />.</Notice>}
            </article>
          )}
      </div>
    </PublicLayout>
  );
}

export const OnboardingAgreement = () => <RequireVerified allowIncomplete>{() => <AgreementBody />}</RequireVerified>;
