import { Router } from 'express';
import { and, count, eq, ilike, or, isNull, isNotNull } from 'drizzle-orm';
import { db, usersTable, userPublicSchema } from '@workspace/db';
import {
  ListTeamUsersQueryParams, ListTeamUsersResponse, InviteAdminBody, InviteAdminResponse,
  SetUserActiveStatusParams, SetUserActiveStatusBody, SetUserActiveStatusResponse,
  SetUserArchivedParams, SetUserArchivedBody, SetUserArchivedResponse,
} from '@workspace/api-zod';
import { AdminActionError, inviteAdministrator, setAccountActive } from '../auth/admin-management';
import { enforceLimit } from '../auth/security';

const router = Router();
router.patch('/users/:userId/archive', async (req, res): Promise<void> => {
  const params = SetUserArchivedParams.safeParse(req.params);
  const body = SetUserArchivedBody.strict().safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Choose an account and whether to archive or restore it.' }); return; }
  try {
    const user = await setAccountActive(req.authUser!, params.data.userId, false, body.data.archived);
    res.set('Cache-Control', 'no-store').json(SetUserArchivedResponse.parse(userPublicSchema.parse(user)));
  } catch (error) {
    if (error instanceof AdminActionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    throw error;
  }
});
router.get('/users', async (req, res): Promise<void> => {
  const parsed = ListTeamUsersQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Choose an account role and valid search or pagination values.' }); return; }
  const { role, q, archive = 'current', limit = 25, offset = 0 } = parsed.data;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit)) {
    res.status(400).json({ error: 'Use whole numbers for pagination.' }); return;
  }
  const search = q?.trim().replace(/[\\%_]/g, '\\$&');
  const filter = and(eq(usersTable.role, role),
    archive === 'archived' ? isNotNull(usersTable.archivedAt) : archive === 'all' ? undefined : isNull(usersTable.archivedAt), search ? or(
    ilike(usersTable.email, `%${search}%`), ilike(usersTable.firstName, `%${search}%`),
    ilike(usersTable.lastName, `%${search}%`),
  ) : undefined);
  const [users, totals] = await Promise.all([
    db.select().from(usersTable).where(filter).orderBy(usersTable.firstName, usersTable.lastName, usersTable.id).limit(limit).offset(offset),
    db.select({ total: count() }).from(usersTable).where(filter),
  ]);
  res.json(ListTeamUsersResponse.parse({
    users: users.map(user => userPublicSchema.parse(user)), total: totals[0]?.total ?? 0, limit, offset,
  }));
});

router.post('/invites', async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | undefined;
  const parsed = InviteAdminBody.safeParse({
    ...body, email: typeof body?.email === 'string' ? body.email.trim().toLowerCase() : body?.email,
  });
  if (!parsed.success) { res.status(400).json({ error: 'Please enter a first name, last name, and valid email.' }); return; }
  if (!await enforceLimit(req, res, 'admin-invite', req.authUser!.id, 3600, 30)) return;
  try {
    const result = await inviteAdministrator(parsed.data, { actor: req.authUser! });
    res.json(InviteAdminResponse.parse({
      ok: true, email: result.user.email, delivery: result.delivery, message: result.message,
    }));
  } catch (error) {
    if (!(error instanceof AdminActionError)) throw error;
    res.status(error.status).json({ error: error.message, code: error.code });
  }
});

router.patch('/users/:userId/status', async (req, res): Promise<void> => {
  const params = SetUserActiveStatusParams.safeParse(req.params);
  const body = SetUserActiveStatusBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Choose a valid account and active status.' }); return; }
  try {
    const user = await setAccountActive(req.authUser!, params.data.userId, body.data.isActive);
    res.json(SetUserActiveStatusResponse.parse(userPublicSchema.parse(user)));
  } catch (error) {
    if (!(error instanceof AdminActionError)) throw error;
    res.status(error.status).json({ error: error.message, code: error.code });
  }
});
export default router;
