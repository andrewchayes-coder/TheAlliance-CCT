import { Router } from 'express';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, usersTable, volunteerProfilesTable, sessionsTable, authTokensTable, messageRecipientsTable } from '@workspace/db';
import {
  GetVolunteerDashboardResponse, UpdateVolunteerProfileBody, UpdateVolunteerProfileResponse,
  ChangeVolunteerPasswordBody, GetVolunteerMessagesResponse, GetVolunteerResourcesResponse,
} from '@workspace/api-zod';
import { appConfig } from '@workspace/shared/appConfig';
import { onboardingQuestions, buildOnboardingAnswersSchema, onboardingContactSchema } from '@workspace/shared/onboardingQuestions';
import { checkPassword, hashPassword, validNewPassword, enforceLimit } from '../auth/security';
import { endSession } from '../auth/session';
import { onboardingAccount } from '../onboarding';
import { volunteerDashboard, ownMessages } from '../volunteer-home';
import { visibleResources } from '../server/resources';
import { volunteerProfileEditSchema } from '@workspace/shared/profileFields';

const router = Router();
router.get('/dashboard', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(GetVolunteerDashboardResponse.parse(await volunteerDashboard(req.authUser!.id)));
});
router.patch('/profile', async (req, res): Promise<void> => {
  const parsed = volunteerProfileEditSchema.extend({
    county: z.enum(appConfig.counties).optional(), availabilityNotes: z.string().trim().max(5000).nullable().optional(),
    answers: z.record(z.string(), z.unknown()).optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Please check your profile information.' }); return; }
  const inputAnswers: Record<string, unknown> = { ...parsed.data.answers };
  for (const question of onboardingQuestions) {
    if (question.profileField === 'county') inputAnswers[question.id] = parsed.data.county;
    if (question.profileField === 'availabilityNotes') inputAnswers[question.id] = parsed.data.availabilityNotes ?? '';
  }
  const answers = buildOnboardingAnswersSchema().safeParse(inputAnswers);
  if (!answers.success) { res.status(400).json({ error: answers.error.issues[0]?.message ?? 'Please check your questionnaire answers.', issues: answers.error.issues }); return; }
  const actor = req.authUser!;
  const saved = await db.transaction(async tx => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!user?.isActive || !user.emailVerifiedAt || user.role !== 'volunteer' || user.sessionVersion !== actor.sessionVersion) return false;
    const [profile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id)).for('update');
    if (!profile?.onboardingCompletedAt) return false;
    const { firstName, lastName, phone, answers: _, ...profileFields } = parsed.data;
    await tx.update(usersTable).set({
      ...(firstName !== undefined ? { firstName } : {}), ...(lastName !== undefined ? { lastName } : {}),
      ...(phone !== undefined ? { phone } : {}), updatedAt:new Date(),
    }).where(eq(usersTable.id, actor.id));
    await tx.update(volunteerProfilesTable).set({
      ...profileFields, updatedAt:new Date(),
      ...(onboardingQuestions.length ? { onboardingAnswers: { ...profile.onboardingAnswers, ...answers.data } } : {}),
    }).where(eq(volunteerProfilesTable.id, profile.id));
    return true;
  });
  if (!saved) { res.status(403).json({ error: 'Your account is not available for profile changes. Please sign in again.' }); return; }
  res.set('Cache-Control', 'no-store').json(UpdateVolunteerProfileResponse.parse(await onboardingAccount(actor.id)));
});
router.post('/password', async (req, res): Promise<void> => {
  const parsed = ChangeVolunteerPasswordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter your current password and matching new passwords of at least 8 characters.' }); return; }
  const validation = validNewPassword(parsed.data.password, parsed.data.confirmPassword);
  if (validation) { res.status(400).json({ error: validation }); return; }
  const actor = req.authUser!;
  if (!await enforceLimit(req, res, 'password-change-user', actor.id, 900, 10) ||
    !await enforceLimit(req, res, 'password-change-ip', req.ip ?? 'unknown', 900, 20)) return;
  if (!await checkPassword(parsed.data.currentPassword, actor.passwordHash)) {
    res.status(400).json({ error: 'Your current password does not match. Please try again.' }); return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const changed = await db.transaction(async tx => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!user?.isActive || user.role !== 'volunteer' || !user.emailVerifiedAt || user.sessionVersion !== actor.sessionVersion ||
      user.passwordHash !== actor.passwordHash) return false;
    await tx.update(usersTable).set({ passwordHash, sessionVersion: user.sessionVersion + 1 }).where(eq(usersTable.id, actor.id));
    await tx.update(authTokensTable).set({ usedAt: new Date() }).where(and(eq(authTokensTable.userId, actor.id), isNull(authTokensTable.usedAt)));
    await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->>'userId' = ${actor.id}`);
    return true;
  });
  if (!changed) { res.status(403).json({ error: 'Your account changed while this request was running. Please sign in again.' }); return; }
  await endSession(req, res);
  res.set('Cache-Control', 'no-store').json({ ok: true, nextPath: '/signin' });
});
router.get('/messages', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(GetVolunteerMessagesResponse.parse(await ownMessages(req.authUser!.id)));
});
router.patch('/messages/:recipientId/read', async (req, res): Promise<void> => {
  const id = z.uuid().safeParse(req.params.recipientId);
  if (!id.success) { res.status(400).json({ error: 'Choose a valid message.' }); return; }
  const [recipient] = await db.update(messageRecipientsTable).set({
    readAt: sql`coalesce(${messageRecipientsTable.readAt}, now())`,
  }).where(and(eq(messageRecipientsTable.id, id.data), eq(messageRecipientsTable.recipientUserId, req.authUser!.id))).returning();
  if (!recipient) { res.status(404).json({ error: 'Message not found.' }); return; }
  res.set('Cache-Control', 'no-store').json({ ok: true, readAt: recipient.readAt!.toISOString() });
});
router.get('/resources', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(GetVolunteerResourcesResponse.parse(await visibleResources(req.authUser!.id, false)));
});
export default router;
