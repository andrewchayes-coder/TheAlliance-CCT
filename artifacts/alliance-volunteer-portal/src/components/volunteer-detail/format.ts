import { appConfig } from '@workspace/shared/appConfig';

export type Badge = 'neutral' | 'good' | 'attention' | 'blocked';
export const TZ = appConfig.timezone;
export const STATUS: Record<string, [string, Badge]> = {
  onboarding: ['Onboarding', 'attention'],
  active: ['Active', 'good'], inactive: ['Inactive', 'blocked'],
};
export const STATUS_ORDER = ['onboarding', 'active', 'inactive'] as const;
export const flags = {
  cert: appConfig.trackCertificationInApp, bg: appConfig.trackBackgroundCheckInApp, agree: appConfig.requireAgreementAcknowledgment,
};
export const CERT: Record<string, [string, Badge]> = {
  not_started: ['Not started', 'neutral'], in_progress: ['In progress', 'attention'], complete: ['Complete', 'good'],
};
export const BG: Record<string, [string, Badge]> = {
  not_started: ['Not started', 'neutral'], pending: ['Pending', 'attention'], cleared: ['Cleared', 'good'], not_cleared: ['Not cleared', 'blocked'],
};
export const ATTN: Record<string, string> = {
  any: 'Any attention', awaiting_review: 'Not active yet', no_shift: 'No shift', certification_expiring: 'Certification expiring',
  background_pending: 'Background pending', onboarding_incomplete: 'Profile incomplete for more than 7 days',
  onboarding_overdue: 'Onboarding for more than 30 days',
};
/** Attention reasons hidden when their tracking flag is off. */
export const attnVisible = (a: string) =>
  !(a === 'certification_expiring' && !appConfig.trackCertificationInApp) && !(a === 'background_pending' && !appConfig.trackBackgroundCheckInApp);
export const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const calDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });
export const stamp = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) + ' PT' : null;
export const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const pacificToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
/** Whole calendar days from Pacific today until a YYYY-MM-DD date. */
export function daysUntil(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = pacificToday().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}
export const dateInput = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
