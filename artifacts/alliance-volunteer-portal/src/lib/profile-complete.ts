import type { Me } from '@workspace/api-client-react';
import { profileCompletionSchema } from '@workspace/shared/profileFields';

/** Mirrors server routing: onboardingCompletedAt AND every required profile field valid. */
export function isProfileComplete(me: Me): boolean {
  const p = me.profile;
  if (!p?.onboardingCompletedAt) return false;
  return profileCompletionSchema.safeParse({ ...p, firstName: me.user.firstName, lastName: me.user.lastName, phone: me.user.phone ?? '' }).success;
}
