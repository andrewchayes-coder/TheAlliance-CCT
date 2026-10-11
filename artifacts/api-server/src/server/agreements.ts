import { and, eq } from 'drizzle-orm';
import { staffContactText } from '@workspace/shared/appConfig';
import { db, appSettingsTable, resourcesTable, volunteerProfilesTable } from '@workspace/db';
import { appConfig } from '@workspace/shared/appConfig';
import { ResourceError } from './resource-error';
import { privateResourceKey } from './resource-files';
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function agreementVersion(query: typeof db | Tx = db) {
  const [settings] = await query.select({ version: appSettingsTable.agreementVersion }).from(appSettingsTable)
    .where(eq(appSettingsTable.id, 'schedule'));
  return settings?.version ?? appConfig.agreementVersion;
}
/** Same settings-first order is used by acknowledgment and standing-shift mutations. */
export async function lockAgreementVersion(tx: Tx) {
  await tx.insert(appSettingsTable).values({ id: 'schedule' }).onConflictDoNothing();
  const [settings] = await tx.select({ version: appSettingsTable.agreementVersion }).from(appSettingsTable)
    .where(eq(appSettingsTable.id, 'schedule')).for('share');
  return settings!.version;
}
export const agreementTitles = ['User Agreement', 'Safety Guidelines'] as const;
const readable = (r: { type: string; body: string | null; fileKey: string | null }) =>
  r.type === 'article' ? !!r.body?.trim() : r.type === 'document' && !!r.fileKey &&
    (privateResourceKey(r.fileKey) || /^seed-resources\/[\w-]+\.pdf$/.test(r.fileKey));
export async function bumpAgreementVersion(tx: Tx) {
  await tx.insert(appSettingsTable).values({ id: 'schedule' }).onConflictDoNothing();
  const [settings] = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.id, 'schedule')).for('update');
  const docs = await tx.select().from(resourcesTable).where(and(eq(resourcesTable.category, 'Agreements'),
    eq(resourcesTable.isPublished, true)));
  if (!agreementTitles.every(title => docs.some(r => r.title === title && readable(r))))
    throw new ResourceError('Publish both agreement documents or articles before requiring a new version.');
  const match = /^v(\d+)$/.exec(settings!.agreementVersion);
  const version = match ? `v${BigInt(match[1]!) + 1n}` : `${settings!.agreementVersion}.${Date.now()}`;
  await tx.update(appSettingsTable).set({ agreementVersion: version, updatedAt: new Date() }).where(eq(appSettingsTable.id, 'schedule'));
  return version;
}
export async function acknowledgeAgreement(userId: string, expected: string) {
  return db.transaction(async tx => {
    const version = await lockAgreementVersion(tx);
    if (version !== expected) throw new ResourceError('The agreements changed while you were reading. Reload and review the current version.');
    const docs = await tx.select().from(resourcesTable).where(and(eq(resourcesTable.category, 'Agreements'), eq(resourcesTable.isPublished, true)));
    if (!agreementTitles.every(title => docs.some(r => r.title === title && readable(r))))
      throw new ResourceError(`The current agreements are not available. Please contact ${staffContactText}.`);
    const [profile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId)).for('update');
    if (!profile?.onboardingCompletedAt) throw new ResourceError('Please complete onboarding first.', 403);
    if (profile.agreementVersion === version && profile.agreementAcknowledgedAt)
      return { version, acknowledgedAt: profile.agreementAcknowledgedAt.toISOString() };
    const at = new Date();
    await tx.update(volunteerProfilesTable).set({ agreementVersion: version, agreementAcknowledgedAt: at, updatedAt: at })
      .where(eq(volunteerProfilesTable.id, profile.id));
    return { version, acknowledgedAt: at.toISOString() };
  });
}
