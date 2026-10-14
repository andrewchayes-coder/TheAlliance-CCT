import { Router, type IRouter } from 'express';
import { eq } from 'drizzle-orm';
import { db, volunteerProfilesTable, volunteerProfilePublicColumns, volunteerProfilePublicSchema, userPublicSchema } from '@workspace/db';
import { GetMeResponse } from '@workspace/api-zod';
import { agreementVersion } from '../server/agreements';
import { testAccounts } from '@workspace/shared/testAccounts';
import { appConfig } from '@workspace/shared/appConfig';
import { normalizeVolunteerStatus } from '@workspace/shared/profileFields';

const router: IRouter = Router();
router.get('/me', async (req, res): Promise<void> => {
  const user = req.authUser!;
  const [profile] = user.role === 'volunteer' ? await db.select(volunteerProfilePublicColumns)
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)).limit(1) : [];
  const version = await agreementVersion();
  res.json(GetMeResponse.parse({
    currentAgreementVersion: version,
    testPersona: user.isTestAccount ? testAccounts.find(persona => persona.email === user.email)?.key : undefined,
    agreementRequired: appConfig.requireAgreementAcknowledgment && !!profile?.onboardingCompletedAt &&
      (!profile.agreementAcknowledgedAt || profile.agreementVersion !== version),
    user: userPublicSchema.parse(user), role: user.role, verified: Boolean(user.emailVerifiedAt),
    profile: profile ? volunteerProfilePublicSchema.parse(profile) : null,
  }));
});
export default router;
