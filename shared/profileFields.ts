import { z } from 'zod/v4';
import { appConfig } from './appConfig';

export const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'] as const;
export const requiredProfileFields = {
  firstName: 'First name', lastName: 'Last name', phone: 'Mobile phone', dateOfBirth: 'Date of birth',
  addressLine1: 'Home address', city: 'City', state: 'State', zip: 'ZIP',
  emergencyContactName: 'Emergency contact name', emergencyContactRelationship: 'Emergency contact relationship',
  emergencyContactPhone: 'Emergency contact phone',
} as const;
export function normalizeVolunteerStatus(status: string): 'onboarding' | 'active' | 'inactive' {
  if (status === 'applicant' || status === 'in_training' || status === 'onboarding') return 'onboarding';
  if (status === 'active' || status === 'inactive') return status;
  throw new Error('Unknown volunteer status');
}
export function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}
export function formatPhone(value: string | null | undefined) {
  const digits = phoneDigits(value ?? '').slice(0, 10);
  if (!digits) return '';
  return `(${digits.slice(0,3)}${digits.length >= 3 ? ') ' : ''}${digits.slice(3,6)}${digits.length > 6 ? '-' : ''}${digits.slice(6)}`;
}
export function pacificToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: appConfig.timezone, year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  return ['year','month','day'].map(key => parts.find(p => p.type === key)!.value).join('-');
}
export const calendarDateSchema = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value, 'Enter a valid calendar date.');
const dob = calendarDateSchema.refine(value => value < pacificToday(), 'Date of birth must be in the past.')
  .refine(value => appConfig.minimumAge === null || value <= `${Number(pacificToday().slice(0,4))-appConfig.minimumAge}${pacificToday().slice(4)}`, 'The minimum age requirement has not been met.');
const text = (label: string, length = 200) => z.string().trim().min(1, `Enter ${label.toLowerCase()}.`).max(length);
const phone = z.string().transform(phoneDigits).refine(value => /^\d{10}$/.test(value), 'Enter a 10-digit phone number.');
export const profileCompletionSchema = z.object({
  firstName: text('First name',100), lastName: text('Last name',100), phone,
  dateOfBirth: dob, addressLine1: text('Home address',300), city: text('City',100), state: z.enum(states),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, 'Enter a 5-digit ZIP or ZIP+4.'),
  emergencyContactName: text('Emergency contact name'), emergencyContactRelationship: text('Emergency contact relationship',100),
  emergencyContactPhone: phone,
});
export const profileDraftSchema = z.object({
  firstName: z.string().trim().max(100), lastName: z.string().trim().max(100),
  phone: z.string().transform(phoneDigits).refine(value => /^\d{0,10}$/.test(value), 'Enter a phone number.'),
  dateOfBirth: dob.nullable(), addressLine1: z.string().trim().max(300).nullable(), city: z.string().trim().max(100).nullable(),
  state: z.enum(states).nullable(), zip: z.string().trim().regex(/^[\d-]{0,10}$/).nullable(),
  emergencyContactName: z.string().trim().max(200).nullable(), emergencyContactRelationship: z.string().trim().max(100).nullable(),
  emergencyContactPhone: z.string().transform(phoneDigits).refine(value => /^\d{0,10}$/.test(value)).nullable(),
}).partial();
export const volunteerProfileEditSchema = profileCompletionSchema.omit({ dateOfBirth: true }).partial();
export function missingProfileFields(user: {firstName: string;lastName: string;phone: string|null}, profile: Record<string, unknown>) {
  const values = { ...profile, firstName:user.firstName,lastName:user.lastName,phone:user.phone };
  return Object.entries(requiredProfileFields).filter(([key]) => !profileCompletionSchema.shape[key as keyof typeof requiredProfileFields].safeParse(values[key as keyof typeof values]).success)
    .map(([key,label]) => ({key:`profile_${key}`,label,met:false}));
}
