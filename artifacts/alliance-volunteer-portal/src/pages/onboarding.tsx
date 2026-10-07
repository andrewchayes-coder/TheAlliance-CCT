import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, ExternalLink, FileText } from 'lucide-react';
import {
  getGetOnboardingAgreementQueryKey, getGetOnboardingAgreementsQueryKey, useGetOnboardingAgreement,
  useGetOnboardingAgreements, useSaveOnboarding, type Me,
} from '@workspace/api-client-react';
import {
  buildOnboardingAnswersSchema, onboardingContactSchema, onboardingQuestions, type OnboardingQuestion,
} from '@workspace/shared/onboardingQuestions';
import { PublicLayout, Button, EmptyState } from '@/components/brand-system';
import { Skeleton } from '@/components/ui/skeleton';
import { RequireVerified } from '@/auth/guards';
import { Field, Notice } from '@/auth/auth-ui';
import { FETCH_CREDS, FRESH_MS, readError, useAuth } from '@/auth/auth-context';

type Contact = { firstName: string; lastName: string; phone: string };
type Answers = Record<string, unknown>;
type Errors = Record<string, string>;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) { const k = String(i.path[0] ?? ''); if (k && !out[k]) out[k] = i.message; }
  return out;
}

const choiceClass = 'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-gray px-3.5 py-2.5 text-[15px] has-[:checked]:bg-[#d7efee] has-[:checked]:ring-2 has-[:checked]:ring-teal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal';

function QuestionField({ q, value, error, onChange }: { q: OnboardingQuestion; value: unknown; error?: string; onChange: (v: unknown) => void }) {
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
        <label htmlFor={id} className="mb-1.5 block text-sm font-bold">{q.label}{q.required && <span className="text-teal-text"> (required)</span>}</label>
        {control}
        <FieldNote id={descId} error={error} help={q.helpText} />
      </div>
    );
  }
  // radio, yesno, multiselect: fieldset of native inputs
  const arr = Array.isArray(value) ? (value as string[]) : [];
  return (
    <fieldset aria-describedby={described} aria-invalid={!!error}>
      <legend className="mb-1.5 text-sm font-bold">{q.label}{q.required && <span className="text-teal-text"> (required)</span>}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.type === 'yesno' && [true, false].map(b => (
          <label key={String(b)} className={choiceClass}>
            <input type="radio" name={id} className="size-4 accent-[#02928f]" checked={value === b} onChange={() => onChange(b)} />{b ? 'Yes' : 'No'}
          </label>
        ))}
        {q.type === 'radio' && q.options?.map(o => (
          <label key={o} className={choiceClass}>
            <input type="radio" name={id} className="size-4 accent-[#02928f]" checked={str === o} onChange={() => onChange(o)} />{o}
          </label>
        ))}
        {q.type === 'multiselect' && q.options?.map(o => (
          <label key={o} className={choiceClass}>
            <input type="checkbox" className="size-4 accent-[#02928f]" checked={arr.includes(o)}
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
      <h2 id="agree-h" className="alliance-display text-[14px]">Our agreements</h2>
      {q.isPending ? <Skeleton className="mt-4 h-24 w-full" /> : q.isError ? (
        <div className="mt-3"><Notice>We couldn't load the agreements.</Notice><Button type="button" variant="secondary" onClick={() => { void q.refetch(); }}>Try again</Button></div>
      ) : d && (
        <>
          {!d.ready && <div className="mt-3"><Notice kind="info">The User Agreement and Safety Guidelines aren't both available yet, so onboarding can't be finished today. You can save your progress and return later. Please check back soon, or contact the Alliance.</Notice></div>}
          {d.resources.length > 0 && (
            <ul className="mt-3 divide-y divide-gray">
              {d.resources.map(r => (
                <li key={r.id}>
                   <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/onboarding/agreements/${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer" data-testid={`link-agreement-${r.id}`}
                    className="flex min-h-11 items-center gap-3 py-2 font-bold text-teal-text underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-teal">
                    <FileText size={18} aria-hidden="true" />{r.title}<span className="sr-only"> (opens in a new tab)</span><ExternalLink size={14} aria-hidden="true" className="ml-auto" />
                   </a>
                </li>
              ))}
            </ul>
          )}
          <label className={`${choiceClass} mt-4 ${d.ready ? '' : 'opacity-60'}`}>
            <input type="checkbox" className="size-5 shrink-0 accent-[#02928f]" checked={checked} disabled={!d.ready} data-testid="checkbox-agreement"
              onChange={e => onCheck(e.target.checked)} />
            <span>I have read and agree to the Volunteer User Agreement and Safety Guidelines.</span>
          </label>
          {error && <p role="alert" className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{error}</p>}
        </>
      )}
    </section>
  );
}

function OnboardingForm({ me }: { me: Me }) {
  const auth = useAuth();
  const [, nav] = useLocation();
  const save = useSaveOnboarding({ request: auth.request });
  const mutateRef = useRef(save.mutateAsync);
  mutateRef.current = save.mutateAsync;

  const [contact, setContact] = useState<Contact>(() => ({ firstName: me.user.firstName ?? '', lastName: me.user.lastName ?? '', phone: me.user.phone ?? '' }));
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(me.profile?.onboardingAnswers ?? {}) }));
  const [step, setStep] = useState<1 | 2>(() =>
    onboardingContactSchema.safeParse(me.user).success &&
    buildOnboardingAnswersSchema({ step: 1 }).safeParse(me.profile?.onboardingAnswers ?? {}).success ? 2 : 1);
  const [agreed, setAgreed] = useState(false);
  const [agr, setAgr] = useState({ ready: false, version: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [finishing, setFinishing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const latest = useRef({ contact, answers });
  latest.current = { contact, answers };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastKey = useRef(JSON.stringify({ contact, answers }));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizing = useRef(false);

  const done = !!me.profile?.onboardingCompletedAt;
  useEffect(() => { if (done && !finalizing.current) nav('/dashboard', { replace: true }); }, [done, nav]);

  const draftPayload = useCallback(() => {
    const { contact: c, answers: a } = latest.current;
    const cp = onboardingContactSchema.safeParse(c);
    const ap = buildOnboardingAnswersSchema({ draft: true }).safeParse(a);
    return { cp, ap };
  }, []);

  const saveDraft = useCallback(async (explicit: boolean): Promise<boolean> => {
    if (finalizing.current) return true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const { cp, ap } = draftPayload();
    if (!cp.success || !ap.success) {
      if (explicit) {
        setErrors({ ...(cp.success ? {} : issuesToErrors(cp.error.issues)), ...(ap.success ? {} : issuesToErrors(ap.error.issues)) });
        setSaveState('error');
      }
      return false; // typed-so-far data not yet valid; kept in memory only
    }
    const key = JSON.stringify(latest.current);
    lastKey.current = key;
    setSaveState('saving');
    const p = queue.current.catch(() => undefined).then(() => mutateRef.current({ data: { ...cp.data, answers: ap.data, complete: false } }));
    queue.current = p;
    try {
      await p;
      if (!finalizing.current) setSaveState(key === JSON.stringify(latest.current) ? 'saved' : 'saving');
      return true;
    } catch (e) {
      lastKey.current = '';
      setSaveState('error');
      if (explicit) setFormErr(readError(e).message);
      return false;
    }
  }, [draftPayload]);

  useEffect(() => {
    if (finalizing.current) return;
    const key = JSON.stringify({ contact, answers });
    if (key === lastKey.current) return;
    timer.current = setTimeout(() => { void saveDraft(false); }, 1500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [contact, answers, saveDraft]);

  const setAnswer = (id: string, v: unknown) => { setAnswers(a => ({ ...a, [id]: v })); setErrors(e => ({ ...e, [id]: '' })); setFormErr(null); };
  const setC = (k: keyof Contact, v: string) => { setContact(c => ({ ...c, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); setFormErr(null); };

  function validate(forStep: 1 | 2 | 'all'): boolean {
    const errs: Errors = {};
    if (forStep !== 2) {
      const c = onboardingContactSchema.safeParse(contact);
      if (!c.success) Object.assign(errs, issuesToErrors(c.error.issues));
    }
    const a = buildOnboardingAnswersSchema(forStep === 'all' ? {} : { step: forStep }).safeParse(answers);
    if (!a.success) Object.assign(errs, issuesToErrors(a.error.issues));
    if (forStep !== 1) {
      if (!agr.ready) errs.agreement = 'Agreements are not available yet.';
      else if (!agreed) errs.agreement = 'Please confirm you agree to continue.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function next() {
    setFormErr(null);
    if (!validate(1)) { setFormErr('Please fix the highlighted answers to continue.'); return; }
    if (!await saveDraft(true)) return;
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    setFormErr(null);
    if (finishing) return;
    if (!validate('all')) {
      setFormErr('A few answers still need attention.');
      if (!onboardingContactSchema.safeParse(contact).success || !buildOnboardingAnswersSchema({ step: 1 }).safeParse(answers).success) setStep(1);
      return;
    }
    setFinishing(true);
    finalizing.current = true;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      await queue.current.catch(() => undefined); // let any pending draft land first
      const c = onboardingContactSchema.parse(latest.current.contact);
      const a = buildOnboardingAnswersSchema().parse(latest.current.answers);
      await mutateRef.current({ data: { ...c, answers: a, complete: true, agreementAcknowledged: true, agreementVersion: agr.version } });
      setLeaving(true);
      await auth.refresh();
      nav('/dashboard', { replace: true });
    } catch (e) {
      finalizing.current = false;
      setLeaving(false);
      setFormErr(readError(e, "We couldn't finish your onboarding. Your answers are safe; please try again.").message);
      setFinishing(false);
    }
  }

  const [outBusy, setOutBusy] = useState(false);
  async function out() {
    setOutBusy(true);
    await saveDraft(false);
    try { await auth.signout(); nav('/'); } catch (e) { setFormErr(readError(e).message); setOutBusy(false); }
  }

  const qs = (s: 1 | 2) => onboardingQuestions.filter(q => q.step === s);
  const statusText = saveState === 'saving' ? 'Saving your progress…' : saveState === 'saved' ? 'Progress saved' : saveState === 'error' ? "Couldn't save yet. We'll retry as you type." : 'Your progress saves as you go.';

  return (
    <PublicLayout contained={false}>
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-14">
        <p className="alliance-label">Step {step} of 2</p>
        <h1 className="alliance-display mt-3 text-[24px] text-navy md:text-[30px]">Welcome, {me.user.firstName}</h1>
        <p className="mt-3">
          {step === 1 ? "Thank you for stepping up. Tell us a little about you so we can match you with the right support." : 'Almost there. A few optional notes, then review our agreements.'}
        </p>
        <div className="mt-5 flex gap-2" aria-hidden="true">
          {[1, 2].map(n => <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors ${n <= step ? 'bg-teal' : 'bg-gray'}`} />)}
        </div>
        <div aria-live="polite" className="mt-5">{formErr && <Notice>{formErr}</Notice>}</div>
        <form noValidate onSubmit={e => { e.preventDefault(); void (step === 1 ? next() : finish()); }} className="mt-4 grid gap-6" data-testid="form-onboarding">
          <fieldset disabled={finishing || outBusy} className="contents">
          {step === 1 && (
            <>
               <fieldset className="grid gap-4 sm:grid-cols-2" disabled={finishing}>
                <legend className="alliance-section-kicker mb-3">Contact details</legend>
                <Field label="First name" required autoComplete="given-name" maxLength={100} value={contact.firstName} error={errors.firstName} onChange={e => setC('firstName', e.target.value)} data-testid="input-first-name" />
                <Field label="Last name" required autoComplete="family-name" maxLength={100} value={contact.lastName} error={errors.lastName} onChange={e => setC('lastName', e.target.value)} data-testid="input-last-name" />
                <Field className="sm:col-span-2" label="Mobile phone" type="tel" required autoComplete="tel" maxLength={40} value={contact.phone} error={errors.phone}
                  hint="We use this only to coordinate your volunteer shifts." onChange={e => setC('phone', e.target.value)} data-testid="input-phone" />
              </fieldset>
              {qs(1).map(q => <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={v => setAnswer(q.id, v)} />)}
            </>
          )}
          {step === 2 && (
            <>
              {qs(2).map(q => <QuestionField key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={v => setAnswer(q.id, v)} />)}
              <AgreementsBlock checked={agreed} onCheck={v => { setAgreed(v); setErrors(e => ({ ...e, agreement: '' })); }} error={errors.agreement} onReady={setAgr} />
            </>
          )}
          <div className="flex flex-col-reverse gap-3 border-t border-gray pt-5 sm:flex-row sm:items-center">
            {step === 2 && <Button type="button" variant="secondary" onClick={() => { setStep(1); window.scrollTo({ top: 0 }); }} data-testid="button-back"><ArrowLeft size={16} aria-hidden="true" />Back</Button>}
            <Button type="button" variant="secondary" onClick={() => { void saveDraft(true); }} disabled={finishing || saveState === 'saving'} data-testid="button-save-progress">Save progress</Button>
            <Button type="submit" className="sm:ml-auto" disabled={finishing || (step === 2 && !agr.ready)} data-testid={step === 1 ? 'button-next' : 'button-finish'}>
              {step === 1 ? 'Continue' : leaving ? 'Opening your dashboard' : finishing ? 'Finishing' : 'Finish onboarding'}
            </Button>
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
        <Link href="/onboarding" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-teal-text underline underline-offset-4"><ArrowLeft size={16} aria-hidden="true" />Back to onboarding</Link>
        {q.isPending ? <div role="status" aria-busy="true"><span className="sr-only">Loading</span><Skeleton className="h-10 w-2/3" /><Skeleton className="mt-6 h-48 w-full" /></div>
          : q.isError || !r ? (
            <>
              <EmptyState title="We couldn't find that document" description="It may have been unpublished or moved. Return to onboarding and open it from the list again." />
              <Button variant="secondary" onClick={() => { void q.refetch(); }}>Try again</Button>
            </>
          ) : (
            <article>
              <p className="alliance-label">{r.type === 'article' ? 'Article' : r.type === 'document' ? 'Document' : 'Link'}</p>
              <h1 className="alliance-display mt-3 text-[22px] md:text-[28px]" data-testid="text-agreement-title">{r.title}</h1>
              {r.body && <div className="mt-5 whitespace-pre-wrap break-words" data-testid="text-agreement-body">{r.body}</div>}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="alliance-button alliance-button-primary mt-6" data-testid="link-agreement-open">
                  {r.type === 'link' ? 'Open link' : 'Open document'}<ExternalLink size={16} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              {!r.body && !href && <Notice kind="info">This resource has no readable content yet. Please contact the Alliance.</Notice>}
            </article>
          )}
      </div>
    </PublicLayout>
  );
}

export const OnboardingAgreement = () => <RequireVerified allowIncomplete>{() => <AgreementBody />}</RequireVerified>;
