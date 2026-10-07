import { Router, type IRouter } from 'express';
import { eq } from 'drizzle-orm';
import { db, volunteerProfilesTable, volunteerProfilePublicColumns, userPublicSchema } from '@workspace/db';
import { GetMeResponse } from '@workspace/api-zod';

const router: IRouter = Router();
router.get('/me', async (req, res): Promise<void> => {
  const user = req.authUser!;
  const [profile] = user.role === 'volunteer' ? await db.select(volunteerProfilePublicColumns)
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, user.id)).limit(1) : [];
  res.json(GetMeResponse.parse({
    user: userPublicSchema.parse(user), role: user.role, verified: Boolean(user.emailVerifiedAt), profile: profile ?? null,
  }));
});
export default router;
