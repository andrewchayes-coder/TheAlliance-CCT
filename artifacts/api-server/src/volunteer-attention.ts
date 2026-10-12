import type { volunteerProfilesTable } from '@workspace/db';
import { addCalendarDays } from './server/schedule-time';
import { appConfig } from '@workspace/shared/appConfig';
import { missingProfileFields, normalizeVolunteerStatus, pacificToday } from '@workspace/shared/profileFields';
type Profile = typeof volunteerProfilesTable.$inferSelect;
export type AttentionReason = 'awaiting_review' | 'no_shift' | 'certification_expiring' | 'background_pending' | 'onboarding_incomplete' | 'onboarding_overdue';
/** Shared business rules without a database, auth configuration, or side effects. */
export function attentionReasons(profile: Pick<Profile, 'status' | 'certificationExpiresAt' | 'backgroundCheckStatus' | 'backgroundCheckSubmittedAt' | 'onboardingCompletedAt'> & Partial<Profile> & {onboardingSince?: Date},
  shifts: number, today: string, user?: {firstName:string;lastName:string;phone:string|null}): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (profile.status === 'active' && shifts === 0) reasons.push('no_shift');
  if (appConfig.trackCertificationInApp && profile.certificationExpiresAt && profile.certificationExpiresAt >= today && profile.certificationExpiresAt <= addCalendarDays(today, 30)) reasons.push('certification_expiring');
  if (appConfig.trackBackgroundCheckInApp && profile.backgroundCheckStatus === 'pending' && profile.backgroundCheckSubmittedAt && profile.backgroundCheckSubmittedAt < addCalendarDays(today, -14)) reasons.push('background_pending');
  if (normalizeVolunteerStatus(profile.status) === 'onboarding') {
    reasons.push('awaiting_review');
    const started = profile.onboardingSince ?? profile.createdAt;
    const since = started ? pacificToday(started) : today;
    const incomplete = !profile.onboardingCompletedAt || (user ? missingProfileFields(user,{...profile}).length > 0 : false);
    if (incomplete && since < addCalendarDays(today,-7)) reasons.push('onboarding_incomplete');
    if (since < addCalendarDays(today,-30)) reasons.push('onboarding_overdue');
  }
  return reasons;
}
