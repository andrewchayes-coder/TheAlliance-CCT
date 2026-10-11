import { z } from 'zod/v4';
import { appConfig } from './appConfig';

export type OnboardingQuestion = {
  id: string;
  label: string;
  helpText?: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'date' | 'yesno';
  options?: readonly string[];
  required: boolean;
  step: 1 | 2;
  /** Optional mapping to a profile field; changing a question ID still works. */
  profileField?: 'county' | 'availabilityNotes';
};

export const onboardingQuestions: readonly OnboardingQuestion[] = [];

function questionSchema(q: OnboardingQuestion, draft: boolean): z.ZodType {
  let schema: z.ZodType;
  if (q.type === 'yesno') schema = z.boolean();
  else if (q.type === 'multiselect') {
    let array = z.array(z.string().refine(v => !!q.options?.includes(v), 'Choose an available option'))
      .max(q.options?.length ?? 100).refine(v => new Set(v).size === v.length, 'Choose each option once');
    if (q.required && !draft) array = array.min(1, 'Choose at least one option');
    schema = array;
  } else if (q.type === 'select' || q.type === 'radio') {
    schema = z.string().refine(v => (!!q.options?.includes(v)) || ((!q.required || draft) && v === ''), 'Choose an available option');
  } else {
    let text = z.string().trim().max(q.type === 'textarea' ? 5000 : 500, 'Please shorten your answer');
    if (q.required && !draft) text = text.min(1, 'Please answer this question');
    schema = q.type === 'date' ? text.refine(v => (!v && (!q.required || draft)) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) &&
        new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v), 'Choose a valid date') : text;
  }
  return !q.required || draft ? schema.optional() : schema;
}

export function buildOnboardingAnswersSchema(options: { step?: 1 | 2; draft?: boolean } = {}) {
  return z.object(Object.fromEntries(onboardingQuestions.filter(q => !options.step || q.step === options.step)
    .map(q => [q.id, questionSchema(q, !!options.draft)]))).strip();
}

export const onboardingContactSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(100),
  lastName: z.string().trim().min(1, 'Enter your last name').max(100),
  phone: z.string().trim().max(40).refine(v => /^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15, 'Enter a valid mobile phone number'),
});

export function formatOnboardingAnswer(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join(', ');
  return typeof value === 'string' ? value : '';
}
