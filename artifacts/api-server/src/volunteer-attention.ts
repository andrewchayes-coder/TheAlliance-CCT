import type { volunteerProfilesTable } from '@workspace/db';
import { addCalendarDays } from './server/schedule-time';
type Profile = typeof volunteerProfilesTable.$inferSelect;
export type AttentionReason = 'no_shift' | 'certification_expiring' | 'background_pending' | 'onboarding_incomplete';
/** Shared business rules without a database, auth configuration, or side effects. */
export function attentionReasons(profile: Pick<Profile, 'status' | 'certificationExpiresAt' | 'backgroundCheckStatus' | 'backgroundCheckSubmittedAt' | 'onboardingCompletedAt'>, shifts: number, today: string): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (profile.status === 'active' && shifts === 0) reasons.push('no_shift');
  if (profile.certificationExpiresAt && profile.certificationExpiresAt >= today && profile.certificationExpiresAt <= addCalendarDays(today, 30)) reasons.push('certification_expiring');
  if (profile.backgroundCheckStatus === 'pending' && profile.backgroundCheckSubmittedAt && profile.backgroundCheckSubmittedAt < addCalendarDays(today, -14)) reasons.push('background_pending');
  if (!profile.onboardingCompletedAt) reasons.push('onboarding_incomplete');
  return reasons;
}
