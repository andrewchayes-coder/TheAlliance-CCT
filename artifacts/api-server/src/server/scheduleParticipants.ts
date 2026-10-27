import { eq } from 'drizzle-orm';
import { usersTable, volunteerProfilesTable } from '@workspace/db';
import { approvalRequirements, WorkflowError, type Transaction } from '../admin-volunteer-detail';

type User = typeof usersTable.$inferSelect;
type Profile = typeof volunteerProfilesTable.$inferSelect;

/** Staff already have approval to serve; volunteer onboarding rules remain unchanged. */
export function scheduleParticipantBlockers(user: User, profile?: Profile | null): string[] {
  const blocked = [
    ...(!user.isActive || user.archivedAt ? ['Account must be active'] : []),
    ...(!user.emailVerifiedAt ? ['Email verified'] : []),
  ];
  if (user.role === 'admin') return blocked;
  if (!profile || profile.status !== 'active') blocked.push('Volunteer must be active');
  if (profile) blocked.push(...approvalRequirements(user, profile).filter(r => !r.met).map(r => r.label));
  return [...new Set(blocked)];
}

/** Scheduling only: never relax lockedVolunteer for roster or identity editing. */
export async function lockedScheduleParticipant(tx: Transaction, userId: string) {
  const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for('update');
  if (!user) throw new WorkflowError(404, 'This team member could not be found.');
  let [profile] = await tx.select().from(volunteerProfilesTable)
    .where(eq(volunteerProfilesTable.userId, userId)).for('update');
  if (user.role === 'admin' && !profile) {
    if (scheduleParticipantBlockers(user).length)
      throw new WorkflowError(422, 'Only active, verified admins can take shifts.');
    [profile] = await tx.insert(volunteerProfilesTable).values({ userId, status: 'active' }).returning();
  }
  if (!profile) throw new WorkflowError(404, 'Volunteer profile not found.');
  // Reactivated staff may take a new assignment, but old assignments stay ended.
  if (user.role === 'admin' && profile.status !== 'active' && !scheduleParticipantBlockers(user).length) {
    [profile] = await tx.update(volunteerProfilesTable).set({ status: 'active', updatedAt: new Date() })
      .where(eq(volunteerProfilesTable.id, profile.id)).returning();
  }
  return { user, profile: profile! };
}
