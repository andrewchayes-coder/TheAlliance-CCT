import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, resourcesTable, volunteerProfilesTable } from '@workspace/db';
import { agreementTitles, agreementVersion, bumpAgreementVersion } from './agreements';
import { deleteResourceFile, privateResourceKey } from './resource-files';
import { logger } from '../lib/logger';
import { ResourceError } from './resource-error';
export const resourceInput = z.object({
  type: z.enum(['document', 'article', 'link']), title: z.string().trim().min(1).max(180),
  category: z.string().trim().min(1).max(80), summary: z.string().trim().max(1000).default(''),
  body: z.string().max(30000).default(''), url: z.string().trim().max(2048).default(''),
  isQuickLink: z.boolean().default(false), isPublished: z.boolean().default(false),
  bumpAgreementVersion: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.type === 'article' && !value.body.trim()) ctx.addIssue({ code: 'custom', message: 'Write the article body before saving.' });
  if (value.type === 'link') {
    try {
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch { ctx.addIssue({ code: 'custom', message: 'Quick links must use a full HTTPS URL without a username or password.' }); }
  }
  if (value.category.toLowerCase() === 'agreements' && (value.type === 'link' ||
    !agreementTitles.some(title => title.toLowerCase() === value.title.toLowerCase())))
    ctx.addIssue({ code: 'custom', message: 'Agreements is reserved for the User Agreement and Safety Guidelines.' });
  if (value.bumpAgreementVersion && value.category.toLowerCase() !== 'agreements')
    ctx.addIssue({ code: 'custom', message: 'Only an agreement document can change the agreement version.' });
});
type Resource = typeof resourcesTable.$inferSelect;
type FileData = Pick<Resource, 'fileKey' | 'fileName' | 'fileMimeType'>;
const legacyKey = (key: string | null) => /^seed-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(key ?? '');
export const resourceHref = (row: Resource) => row.type === 'document'
  ? privateResourceKey(row.fileKey) || legacyKey(row.fileKey) ? `/api/resources/${row.id}/file` : null
  : row.type === 'article' ? `/resources/${row.id}` : (() => {
    try { const url = new URL(row.url ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  })();
export function resourceDto(row: Resource) {
  return { id: row.id, type: row.type, title: row.title, category: row.category, summary: row.summary,
    body: row.type === 'article' ? row.body : null, href: resourceHref(row), url: row.type === 'link' ? resourceHref(row) : null,
    fileName: row.fileName, fileMimeType: row.fileMimeType, isQuickLink: row.isQuickLink,
    isPublished: row.isPublished, sortOrder: row.sortOrder, updatedAt: row.updatedAt.toISOString() };
}
export async function resourceContext() {
  const rows = await db.selectDistinct({ category: resourcesTable.category }).from(resourcesTable).orderBy(resourcesTable.category);
  return { categories: [...new Set(['Agreements', ...rows.map(r => r.category)])], agreementVersion: await agreementVersion() };
}
export async function visibleResources(userId: string, admin: boolean) {
  const [profile] = admin ? [] : await db.select({ status: volunteerProfilesTable.status })
    .from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId));
  const rows = await db.select().from(resourcesTable).where(admin ? undefined : eq(resourcesTable.isPublished, true))
    .orderBy(resourcesTable.sortOrder, resourcesTable.id);
  return rows.filter(r => admin || !(r.type === 'link' && r.isQuickLink && profile?.status !== 'active')).map(resourceDto);
}
export async function resourceForActor(id: string, userId: string, admin: boolean) {
  const [row] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, id));
  if (!row || (!admin && !row.isPublished)) return null;
  if (!admin && row.type === 'link' && row.isQuickLink) {
    const [p] = await db.select({ status: volunteerProfilesTable.status }).from(volunteerProfilesTable).where(eq(volunteerProfilesTable.userId, userId));
    if (p?.status !== 'active') return null;
  }
  return row;
}
export async function saveResource(userId: string, raw: z.infer<typeof resourceInput>, id?: string, file?: FileData) {
  let oldKey: string | null = null;
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(91847314)`);
    const [old] = id ? await tx.select().from(resourcesTable).where(eq(resourcesTable.id, id)).for('update') : [];
    if (id && !old) throw new ResourceError('This resource no longer exists. Reload the list.', 404);
    if (old && old.type !== raw.type) throw new ResourceError('A resource cannot change type. Create a new resource instead.');
    const category = raw.category.toLowerCase() === 'agreements' ? 'Agreements' : raw.category;
    const title = category === 'Agreements' ? agreementTitles.find(t => t.toLowerCase() === raw.title.toLowerCase())! : raw.title;
    if (raw.type === 'document' && !(file?.fileKey ?? old?.fileKey)) throw new ResourceError('Upload a PDF or DOCX before saving a document.', 400);
    if (category === 'Agreements' && raw.isPublished) {
      const duplicates = await tx.select({ id: resourcesTable.id }).from(resourcesTable)
        .where(and(eq(resourcesTable.category, category), eq(resourcesTable.title, title), eq(resourcesTable.isPublished, true)));
      if (duplicates.some(r => r.id !== id)) throw new ResourceError(`Another published ${title} already exists. Unpublish it first.`);
    }
    const values = { type: raw.type, title, category, summary: raw.summary || null,
      body: raw.type === 'article' ? raw.body : null, url: raw.type === 'link' ? new URL(raw.url).href : null,
      isQuickLink: raw.type === 'link' && raw.isQuickLink, isPublished: raw.isPublished, updatedAt: new Date(), ...(file ?? {}) };
    const [max] = await tx.select({ order: sql<number>`coalesce(max(${resourcesTable.sortOrder}), -1)::integer` }).from(resourcesTable).where(eq(resourcesTable.type, raw.type));
    const [row] = old ? await tx.update(resourcesTable).set(values).where(eq(resourcesTable.id, old.id)).returning()
      : await tx.insert(resourcesTable).values({ ...values, sortOrder: max!.order + 1, createdByUserId: userId }).returning();
    if (file && old?.fileKey !== file.fileKey) oldKey = old?.fileKey ?? null;
    const version = raw.bumpAgreementVersion ? await bumpAgreementVersion(tx) : await agreementVersion(tx);
    return { resource: resourceDto(row!), agreementVersion: version, bumped: raw.bumpAgreementVersion };
  });
  if (oldKey) await deleteResourceFile(oldKey).catch(() => logger.warn('Resource saved; an obsolete storage object needs cleanup.'));
  return result;
}
export async function publishResource(id: string, published: boolean, actorId: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(91847314)`);
    const [row] = await tx.select().from(resourcesTable).where(eq(resourcesTable.id, id)).for('update');
    if (!row) throw new ResourceError('This resource no longer exists.', 404);
    if (published && row.category === 'Agreements') {
      const existing = await tx.select({ id: resourcesTable.id }).from(resourcesTable).where(and(
        eq(resourcesTable.category, 'Agreements'), eq(resourcesTable.title, row.title), eq(resourcesTable.isPublished, true)));
      if (existing.some(r => r.id !== row.id)) throw new ResourceError(`Another published ${row.title} already exists. Unpublish it first.`);
    }
    const [updated] = await tx.update(resourcesTable).set({ isPublished: published, updatedAt: new Date() }).where(eq(resourcesTable.id, id)).returning();
    return { resource: resourceDto(updated!), agreementVersion: await agreementVersion(tx), bumped: false };
  });
}
export async function removeResource(id: string) {
  const [row] = await db.delete(resourcesTable).where(eq(resourcesTable.id, id)).returning();
  if (!row) throw new ResourceError('This resource no longer exists.', 404);
  await deleteResourceFile(row.fileKey).catch(() => logger.warn('Resource deleted; a storage object needs cleanup.'));
}
export async function reorderResources(type: Resource['type'], ids: string[]) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(91847314)`);
    const rows = await tx.select({ id: resourcesTable.id }).from(resourcesTable).where(eq(resourcesTable.type, type)).for('update');
    if (new Set(ids).size !== ids.length || rows.length !== ids.length || rows.some(r => !ids.includes(r.id)))
      throw new ResourceError('The list changed. Reload it before reordering.');
    for (const [sortOrder, id] of ids.entries()) await tx.update(resourcesTable).set({ sortOrder, updatedAt: new Date() }).where(eq(resourcesTable.id, id));
  });
}
