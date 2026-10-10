import { createHash } from 'node:crypto';
import { and, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, usersTable, volunteerProfilesTable, messagesTable, messageRecipientsTable, notificationLogTable } from '@workspace/db';
import { appConfig } from '@workspace/shared/appConfig';
import { renderMessageMarkdown } from '@workspace/shared/markdown';
import { createEmailTemplate, sendEmail } from '../email';
import { appOrigin } from '../auth/session';
import { WorkflowError } from '../admin-volunteer-detail';

const draftBase = z.object({
  audience: z.enum(['active', 'all', 'selected', 'single']),
  userIds: z.array(z.uuid().transform(v => v.toLowerCase())).max(500),
  subject: z.string().trim().min(1).max(200).refine(v => !/[\r\n]/.test(v), 'Keep the subject on one line.'),
  body: z.string().trim().min(1).max(20000),
  sendByEmail: z.boolean(),
}).strict();
const uniquePeople = (d: { userIds: string[] }) => new Set(d.userIds).size === d.userIds.length;
const audienceMatches = (d: { audience: string; userIds: string[] }) =>
  d.audience === 'single' ? d.userIds.length === 1 : d.audience === 'selected' ? d.userIds.length > 0 : d.userIds.length === 0;
const audienceError = 'Choose one volunteer for a single message, at least one for selected, and no individual selections for a blast.';
export const messageDraftSchema = draftBase.refine(uniquePeople, 'Choose each volunteer only once.').refine(audienceMatches, audienceError);
export const messageSendSchema = draftBase.extend({
  requestId: z.uuid().transform(v => v.toLowerCase()), previewHash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(uniquePeople, 'Choose each volunteer only once.').refine(audienceMatches, audienceError);
type Draft = z.infer<typeof messageDraftSchema>;
type Actor = { id: string; sessionVersion: number };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const selection = { userId: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName,
  email: usersTable.email, status: volunteerProfilesTable.status };
async function recipients(client: typeof db | Tx, draft?: Draft, query?: { q?: string; ids?: string[] }) {
  const ids = draft && ['single', 'selected'].includes(draft.audience) ? draft.userIds : query?.ids;
  const q = query?.q?.replace(/[\\%_]/g, '\\$&');
  const rows = await client.select(selection).from(usersTable)
    .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.role, 'volunteer'), ids ? inArray(usersTable.id, ids) : undefined,
      draft?.audience === 'active' || draft?.audience === 'all' ? eq(usersTable.isTestAccount, false) : undefined,
      draft?.audience === 'active' ? and(eq(usersTable.isActive, true), eq(volunteerProfilesTable.status, 'active')) : undefined,
      q ? ilike(sql`${usersTable.firstName} || ' ' || ${usersTable.lastName} || ' ' || ${usersTable.email}`, `%${q}%`) : undefined))
    .orderBy(usersTable.firstName, usersTable.lastName, usersTable.id);
  if (draft && ids && rows.length !== ids.length) throw new WorkflowError(422, 'One or more selected people are not volunteers. Refresh your selection.');
  return query && !ids ? rows.slice(0, 100) : rows;
}
export const findMessageVolunteers = (query: { q?: string; ids?: string[] }) => recipients(db, undefined, query);
function digest(draft: Draft, ids: string[]) {
  return createHash('sha256').update(JSON.stringify([draft.audience, draft.subject, draft.body, draft.sendByEmail, [...ids].sort()])).digest('hex');
}
export async function previewMessage(draft: Draft) {
  const people = await recipients(db, draft);
  return { recipients: people, recipientCount: people.length, previewHash: digest(draft, people.map(p => p.userId)),
    ...renderMessageMarkdown(draft.body) };
}
export async function sendMessage(actor: Actor, input: z.infer<typeof messageSendSchema>) {
  const saved = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'message:' + input.requestId}, 0))`);
    const [staff] = await tx.select().from(usersTable).where(eq(usersTable.id, actor.id)).for('update');
    if (!staff || staff.role !== 'admin' || !staff.isActive || !staff.emailVerifiedAt || staff.sessionVersion !== actor.sessionVersion)
      throw new WorkflowError(403, 'Please sign in again with an active staff account.');
    const [prior] = await tx.select().from(messagesTable).where(eq(messagesTable.id, input.requestId));
    if (prior) {
      const priorPeople = await tx.select(selection).from(messageRecipientsTable)
        .innerJoin(usersTable, eq(usersTable.id, messageRecipientsTable.recipientUserId))
        .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.userId, usersTable.id))
        .where(eq(messageRecipientsTable.messageId, prior.id));
      if (prior.senderUserId !== actor.id || prior.subject !== input.subject || prior.body !== input.body ||
        prior.audience !== input.audience || prior.sentByEmail !== input.sendByEmail ||
        (['single', 'selected'].includes(input.audience) && JSON.stringify([...input.userIds].sort()) !== JSON.stringify(priorPeople.map(p => p.userId).sort())) ||
        digest(input, priorPeople.map(p => p.userId)) !== input.previewHash)
        throw new WorkflowError(409, 'This send reference belongs to a different message. Preview your new draft.');
      return { message: prior, people: priorPeople, reused: true, senderEmail: staff.email };
    }
    const people = await recipients(tx, input);
    if (!people.length) throw new WorkflowError(422, 'There are no volunteers in this audience.');
    if (digest(input, people.map(p => p.userId)) !== input.previewHash)
      throw new WorkflowError(409, 'The audience or message changed. Preview again before sending.');
    const [message] = await tx.insert(messagesTable).values({ id: input.requestId, senderUserId: actor.id,
      audience: input.audience, subject: input.subject, body: input.body, sentByEmail: input.sendByEmail }).returning();
    // Snapshot recipients atomically, before any external email delivery.
    for (let i = 0; i < people.length; i += 500)
      await tx.insert(messageRecipientsTable).values(people.slice(i, i + 500).map(p => ({ messageId: message!.id, recipientUserId: p.userId })));
    return { message: message!, people, reused: false, senderEmail: staff.email };
  });
  let skipped = 0, failures = 0;
  if (saved.message.sentByEmail) {
    // Bounded concurrent batches avoid exhausting the database/email connections.
    for (let i = 0; i < saved.people.length; i += 5) await Promise.all(saved.people.slice(i, i + 5).map(async person => {
      const copy = createEmailTemplate({ heading: saved.message.subject, firstName: person.firstName,
        paragraphs: ['Here is a note from The Alliance’s Resource Coordination team.'], markdownBody: saved.message.body,
        cta: { label: 'View in the portal', url: `${appOrigin}/messages?messageId=${saved.message.id}` } });
      const result = await sendEmail({ type: 'message', to: person.email, toUserId: person.userId, subject: saved.message.subject,
        ...copy, relatedId: saved.message.id,
        replyTo: z.email().safeParse(appConfig.adminContact?.trim()).success ? appConfig.adminContact!.trim() : saved.senderEmail });
      if (result.skipped) skipped++; if (!result.ok) failures++;
    }));
  }
  const logs = await db.select().from(notificationLogTable)
    .where(and(eq(notificationLogTable.type, 'message'), eq(notificationLogTable.relatedId, saved.message.id)))
    .orderBy(desc(notificationLogTable.createdAt));
  const latest = new Map<string, (typeof logs)[number]>();
  for (const row of logs) if (row.recipientUserId && !latest.has(row.recipientUserId)) latest.set(row.recipientUserId, row);
  return { messageId: saved.message.id, recipientCount: saved.people.length, reused: saved.reused, skipped,
    sent: [...latest.values()].filter(r => r.status === 'sent').length,
    logged: [...latest.values()].filter(r => r.status === 'logged').length,
    failed: Math.max(failures, [...latest.values()].filter(r => r.status === 'failed').length) };
}
export async function listMessages(userId?: string, messageId?: string) {
  const rows = await db.select({ id: messagesTable.id, subject: messagesTable.subject, body: messagesTable.body,
    audience: messagesTable.audience, sentByEmail: messagesTable.sentByEmail, sentAt: messagesTable.sentAt,
    recipientCount: count(messageRecipientsTable.id),
    readCount: sql<number>`count(${messageRecipientsTable.readAt})`.mapWith(Number),
    readAt: sql<Date | null>`max(case when ${messageRecipientsTable.recipientUserId} = ${userId ?? null}::uuid then ${messageRecipientsTable.readAt} end)`,
  }).from(messagesTable).leftJoin(messageRecipientsTable, eq(messageRecipientsTable.messageId, messagesTable.id))
    .where(and(messageId ? eq(messagesTable.id, messageId) : undefined, userId ? exists(db.select({ id: sql`1` })
      .from(messageRecipientsTable).where(and(eq(messageRecipientsTable.messageId, messagesTable.id), eq(messageRecipientsTable.recipientUserId, userId)))) : undefined))
    .groupBy(messagesTable.id).orderBy(desc(messagesTable.sentAt), messagesTable.id);
  return rows.map(r => ({ ...r, sentAt: r.sentAt.toISOString(), readAt: r.readAt ? new Date(r.readAt).toISOString() : null }));
}
export async function messageDetail(id: string) {
  const [message] = await listMessages(undefined, id);
  if (!message) throw new WorkflowError(404, 'Message not found.');
  const people = await db.select({ ...selection, readAt: messageRecipientsTable.readAt }).from(messageRecipientsTable)
    .innerJoin(usersTable, eq(usersTable.id, messageRecipientsTable.recipientUserId))
    .innerJoin(volunteerProfilesTable, eq(volunteerProfilesTable.userId, usersTable.id))
    .where(eq(messageRecipientsTable.messageId, id)).orderBy(usersTable.firstName, usersTable.lastName, usersTable.id);
  return { message, recipients: people.map(p => ({ ...p, readAt: p.readAt?.toISOString() ?? null })) };
}
export async function messageContext(userId: string) {
  const [unread] = await db.select({ n: count() }).from(messageRecipientsTable)
    .where(and(eq(messageRecipientsTable.recipientUserId, userId), isNull(messageRecipientsTable.readAt)));
  const [staff] = await db.select({ email: usersTable.email }).from(usersTable)
    .where(and(eq(usersTable.role, 'admin'), eq(usersTable.isActive, true), isNotNull(usersTable.emailVerifiedAt)))
    .orderBy(usersTable.createdAt, usersTable.id).limit(1);
  return { unreadCount: unread!.n, adminContact: appConfig.adminContact?.trim() || staff?.email || null };
}
