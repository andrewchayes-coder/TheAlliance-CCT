import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, usersTable, volunteerProfilesTable } from '@workspace/db';
import { SaveOnboardingBody, SaveOnboardingResponse, GetVolunteerOnboardingResponse } from '@workspace/api-zod';
import { buildOnboardingAnswersSchema, onboardingContactSchema, onboardingQuestions } from '@workspace/shared/onboardingQuestions';
import { onboardingAccount, publishedAgreements, sendWelcome, exportOnboardingCsv } from '../onboarding';
import { appConfig } from '@workspace/shared/appConfig';
import { profileDraftSchema, profileCompletionSchema } from '@workspace/shared/profileFields';

const router = Router();
router.get('/onboarding/agreements', async (_req, res) => {
  res.set('Cache-Control', 'no-store').json(await publishedAgreements());
});
router.get('/onboarding/agreements/:resourceId', async (req, res) => {
  const { resources } = await publishedAgreements();
  const resource = resources.find(row => row.id === req.params.resourceId);
  if (!resource) { res.status(404).json({ error: 'This agreement is not currently published.' }); return; }
  res.set('Cache-Control', 'no-store').json(resource);
});

router.patch('/onboarding', async (req, res): Promise<void> => {
  const parsed = profileDraftSchema.extend({
    complete: z.boolean().optional(), answers: z.record(z.string(), z.unknown()).optional(),
    agreementAcknowledged: z.boolean().optional(), agreementVersion: z.string().nullable().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Please check the onboarding form.', fieldErrors: parsed.error.flatten().fieldErrors, issues: parsed.error.issues }); return; }
  const agreement = appConfig.requireAgreementAcknowledgment && parsed.data.complete ? await publishedAgreements() : null;
  if (agreement && (!parsed.data.agreementAcknowledged || !agreement.ready || parsed.data.agreementVersion !== agreement.version)) {
    res.status(400).json({ error: !agreement.ready
      ? 'Our team is preparing the User Agreement and Safety Guidelines. Your progress can be saved, but onboarding cannot be submitted yet.'
      : 'Please read and acknowledge the current User Agreement and Safety Guidelines.', code: 'AGREEMENT_REQUIRED' }); return;
  }
  const actor = req.authUser!;
  const result = await db.transaction(async tx => {
    // Same lock order as account deactivation; an old authorized request cannot edit a deactivated account.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!user?.isActive || !user.emailVerifiedAt || user.role !== 'volunteer' || user.sessionVersion !== actor.sessionVersion) return { code: 'UNAUTHORIZED' } as const;
    const [profile] = await tx.select().from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, actor.id)).for('update');
    if (!profile) return { code: 'MISSING_PROFILE' } as const;
    const existingComplete = profileCompletionSchema.safeParse({ ...profile, firstName:user.firstName,lastName:user.lastName,phone:user.phone }).success;
    if (profile.onboardingCompletedAt && existingComplete) {
      return parsed.data.complete ? { user, profile } : { code: 'ALREADY_COMPLETED' } as const;
    }
    if (profile.onboardingCompletedAt && profile.dateOfBirth && parsed.data.dateOfBirth !== undefined &&
      parsed.data.dateOfBirth !== profile.dateOfBirth)
      return { code: 'DOB_LOCKED' } as const;
    const answers = buildOnboardingAnswersSchema({ draft: !parsed.data.complete }).safeParse({ ...profile.onboardingAnswers, ...parsed.data.answers });
    if (!answers.success) return { code: 'VALIDATION', issues: answers.error.issues } as const;
    const { complete, answers: _, agreementAcknowledged: _ack, agreementVersion: _version, ...draftFields } = parsed.data;
    let fields = draftFields;
    if (complete) {
      const completion = profileCompletionSchema.safeParse({ ...profile, firstName:user.firstName,lastName:user.lastName,phone:user.phone,...draftFields });
      if (!completion.success) return { code: 'VALIDATION', issues: completion.error.issues } as const;
      fields = completion.data;
    }
    const { firstName, lastName, phone, ...profileFields } = fields;
    const mapped: { county?: string; availabilityNotes?: string | null } = {};
    for (const question of onboardingQuestions) {
      if (question.profileField === 'county' && typeof answers.data[question.id] === 'string' && answers.data[question.id]) mapped.county = answers.data[question.id] as string;
      if (question.profileField === 'availabilityNotes') mapped.availabilityNotes = (answers.data[question.id] as string | undefined) || null;
    }
    const now = new Date();
    const [savedUser] = await tx.update(usersTable).set({
      ...(firstName !== undefined ? { firstName } : {}), ...(lastName !== undefined ? { lastName } : {}),
      ...(phone !== undefined ? { phone } : {}), updatedAt:now,
    }).where(eq(usersTable.id, actor.id)).returning();
    const [savedProfile] = await tx.update(volunteerProfilesTable).set({
      ...profileFields, ...mapped, updatedAt:now,
      ...(onboardingQuestions.length ? { onboardingAnswers: { ...profile.onboardingAnswers, ...answers.data } } : {}),
      ...(complete ? { onboardingCompletedAt: now, ...(agreement ? { agreementAcknowledgedAt: now, agreementVersion: agreement.version } : {}) } : {}),
    }).where(eq(volunteerProfilesTable.id, profile.id)).returning();
    return { user: savedUser!, profile: savedProfile! };
  });
  if ('code' in result) {
    if (result.code === 'VALIDATION') {
      res.status(400).json({ error: 'Please complete the required profile fields.', issues: result.issues,
        fieldErrors: Object.fromEntries(result.issues.map(issue => [issue.path.join('.'), [issue.message]])) }); return;
    }
    res.status(result.code === 'UNAUTHORIZED' ? 403 : result.code === 'MISSING_PROFILE' ? 404 : 409)
      .json({ error: result.code === 'ALREADY_COMPLETED' ? 'Your onboarding is already complete.' :
        result.code === 'DOB_LOCKED' ? 'Only Alliance staff can change your date of birth after onboarding.' : 'Your volunteer account is not available.', code: result.code }); return;
  }
  if (parsed.data.complete) await sendWelcome(result.user, result.profile.id);
  res.set('Cache-Control', 'no-store').json(SaveOnboardingResponse.parse(await onboardingAccount(actor.id)));
});

router.get('/admin/volunteers/onboarding.csv', async (_req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="volunteer-onboarding.csv"', 'X-Content-Type-Options': 'nosniff' });
  res.send(await exportOnboardingCsv());
});
router.get('/admin/volunteers/:userId/onboarding', async (req, res) => {
  if (!z.uuid().safeParse(req.params.userId).success) { res.status(400).json({ error: 'Choose a valid volunteer.' }); return; }
  const account = await onboardingAccount(req.params.userId);
  if (!account) { res.status(404).json({ error: 'Volunteer not found.' }); return; }
  res.set('Cache-Control', 'no-store').json(GetVolunteerOnboardingResponse.parse(account));
});
export default router;
