import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, usersTable, resourcesTable, volunteerProfilesTable, appSettingsTable } from '@workspace/db';
import { documentKind, MAX_RESOURCE_FILE, deleteResourceFile } from './resource-files';
import { resourceInput, saveResource, reorderResources } from './resources';
import { agreementVersion, acknowledgeAgreement } from './agreements';
import { wordFixture } from './resource-files.fixtures';
vi.hoisted(() => { process.env.NODE_ENV = 'development'; process.env.APP_ORIGIN = 'https://portal.example.invalid'; });
const tag = randomUUID(), csrf = `resource-csrf-${tag}`;
const users: string[] = [], sessions: string[] = [];
let base: string, server: import('node:http').Server, originalVersion: string, testVersion: string;
let admin: string, volunteer: string, unverified: string, cookieA: string, cookieV: string, cookieU: string;
let docId: string, articleId: string, pdf: Buffer;
const originalOrders: Array<{ id: string; sortOrder: number }> = [];
async function makeCookie(userId: string) {
  const sid = randomUUID(); sessions.push(sid);
  await pool.query('INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,now()+interval \'1 hour\')',
    [sid, JSON.stringify({ userId, authVersion: 0, csrfToken: csrf,
      cookie: { originalMaxAge: 3600000, secure: true, httpOnly: true, sameSite: 'lax', path: '/' } })]);
  const signed = createHmac('sha256', process.env.SESSION_SECRET!).update(sid).digest('base64').replace(/=+$/, '');
  return `alliance.sid=${encodeURIComponent(`s:${sid}.${signed}`)}`;
}
const data = (type: 'article' | 'document' | 'link', extra = {}) => ({ type, title: `QA ${tag}`,
  category: 'QA resources', summary: 'Temporary owned resource', body: type === 'article' ? '# Thank you\n\n**Care** and [help](https://example.invalid/help).' : '',
  url: type === 'link' ? 'https://example.invalid/help' : '', isQuickLink: false, isPublished: false, bumpAgreementVersion: false, ...extra });
type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };
async function request(path: string, cookie = cookieA, method = 'GET', body?: unknown): Promise<TestResponse> {
  const headers: Record<string, string> = { Cookie: cookie, Origin: process.env.APP_ORIGIN! };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  return fetch(`${base}${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
}
function form(metadata: unknown, bytes?: Buffer, name = 'guide.pdf') {
  const body = new FormData(); body.set('metadata', JSON.stringify(metadata));
  if (bytes) body.set('file', new Blob([new Uint8Array(bytes)]), name);
  return body;
}
beforeAll(async () => {
  originalVersion = await agreementVersion();
  originalOrders.push(...await db.select({ id: resourcesTable.id, sortOrder: resourcesTable.sortOrder }).from(resourcesTable));
  pdf = await readFile('seed-resources/volunteer-handbook.pdf');
  for (const [i, role] of ['admin', 'volunteer', 'volunteer'].entries()) {
    const [u] = await db.insert(usersTable).values({ firstName: 'Resource test', lastName: 'Temporary', phone: '5555550100',
      email: `resource-${tag}-${i}@example.invalid`, passwordHash: 'not-a-login-password', role: role as 'admin' | 'volunteer',
      emailVerifiedAt: i === 2 ? null : new Date() }).returning();
    users.push(u!.id);
    if (role === 'volunteer') await db.insert(volunteerProfilesTable).values({ userId: u!.id, status: 'active',
      onboardingCompletedAt: new Date(), dateOfBirth:'1990-01-01',addressLine1:'123 Test St',city:'Auburn',state:'CA',zip:'95603',
      emergencyContactName:'Test Contact',emergencyContactRelationship:'Friend',emergencyContactPhone:'5555550100',
      agreementAcknowledgedAt: new Date(), agreementVersion: originalVersion, adminNotes: 'private staff-only fixture' });
  }
  [admin, volunteer, unverified] = users as [string,string,string];
  [cookieA, cookieV, cookieU] = await Promise.all(users.map(makeCookie));
  const app = (await import('../app')).default;
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
}, 30000);
afterAll(async () => {
  if (testVersion) await db.update(appSettingsTable).set({ agreementVersion: originalVersion })
    .where(eq(appSettingsTable.agreementVersion, testVersion));
  for (const row of originalOrders) await db.update(resourcesTable).set({ sortOrder: row.sortOrder }).where(eq(resourcesTable.id, row.id));
  const owned = await db.select().from(resourcesTable).where(inArray(resourcesTable.createdByUserId, users));
  for (const row of owned) await deleteResourceFile(row.fileKey);
  await db.delete(resourcesTable).where(inArray(resourcesTable.createdByUserId, users));
  await db.delete(volunteerProfilesTable).where(inArray(volunteerProfilesTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
  await pool.query('DELETE FROM sessions WHERE sid=any($1::text[])', [sessions]);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}, 30000);
describe('private resource hub', () => {
  it('validates HTTPS, reserved category, content types and size', () => {
    expect(() => resourceInput.parse(data('link', { url: 'http://example.invalid' }))).toThrow();
    expect(() => resourceInput.parse(data('link', { url: 'https://name:pass@example.invalid' }))).toThrow();
    expect(() => resourceInput.parse(data('article', { title: 'Other', category: 'agreements' }))).toThrow();
    expect(() => resourceInput.parse(data('link', { title: 'User Agreement', category: 'Agreements' }))).toThrow();
    expect(documentKind('guide.pdf', pdf).extension).toBe('pdf');
    expect(() => documentKind('fake.pdf', Buffer.from('not a PDF'))).toThrow();
    expect(() => documentKind('tiny.docx', Buffer.from('P'))).toThrow();
    expect(() => documentKind('not.docx', Buffer.from('PK\\x03\\x04'))).toThrow();
    expect(() => documentKind('oversize.pdf', Buffer.alloc(MAX_RESOURCE_FILE + 1))).toThrow();
  });
  it('keeps all staff writes protected, including CSRF, and denies unverified downloads', async () => {
    expect((await request('/admin/resources', cookieV)).status).toBe(403);
    expect((await fetch(`${base}/admin/resources`)).status).toBe(401);
    expect((await request('/admin/resources', cookieU)).status).toBe(403);
    expect((await fetch(`${base}/admin/resources`, { method: 'POST', headers: { Cookie: cookieA }, body: form(data('article')) })).status).toBe(403);
    expect((await request('/resources/00000000-0000-4000-8000-000000000000/file', cookieU)).status).toBe(403);
  });
  it('creates draft articles without leaking them, publishes, edits and unpublishes', async () => {
    const create = await request('/admin/resources', cookieA, 'POST', form(data('article')));
    expect(create.status).toBe(201); articleId = (await create.json()).resource.id;
    expect((await request(`/resources/${articleId}`, cookieV)).status).toBe(404);
    expect((await request(`/admin/resources/${articleId}/publish`, cookieA, 'PATCH', { isPublished: true })).status).toBe(200);
    const visible = await request(`/resources/${articleId}`, cookieV);
    const r = await visible.json(); expect(r.body).toContain('**Care**'); expect(r).not.toHaveProperty('createdByUserId');
    const update = await request(`/admin/resources/${articleId}`, cookieA, 'PATCH', form(data('article', { title: `Edited ${tag}`, isPublished: true })));
    expect((await update.json()).resource.title).toBe(`Edited ${tag}`);
    expect((await request(`/admin/resources/${articleId}/publish`, cookieA, 'PATCH', { isPublished: false })).status).toBe(200);
    expect((await request('/resources', cookieV)).status).toBe(200);
    expect((await (await request('/resources', cookieV)).json()).some((r: {id:string}) => r.id === articleId)).toBe(false);
  });
  it('uploads to real private storage, streams only to authorized accounts, and replaces in place', async () => {
    const res = await request('/admin/resources', cookieA, 'POST', form(data('document'), pdf));
    expect(res.status).toBe(201);
    const dto = (await res.json()).resource; docId = dto.id;
    expect(dto.href).toBe(`/api/resources/${docId}/file`); expect(dto).not.toHaveProperty('fileKey');
    expect((await fetch(`${base}/resources/${docId}/file`)).status).toBe(401);
    expect((await request(`/resources/${docId}/file`, cookieV)).status).toBe(404);
    await request(`/admin/resources/${docId}/publish`, cookieA, 'PATCH', { isPublished: true });
    const view = await request(`/resources/${docId}/file`, cookieV);
    expect(view.headers.get('content-type')).toContain('application/pdf');
    expect(view.headers.get('content-disposition')).toContain('inline');
    expect(view.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await view.arrayBuffer()).equals(pdf)).toBe(true);
    const replacement = Buffer.concat([pdf, Buffer.from('\n% QA replacement\n')]);
    const updated = await request(`/admin/resources/${docId}`, cookieA, 'PATCH', form(data('document', { isPublished: true }), replacement, 'replacement.pdf'));
    expect((await updated.json()).resource.id).toBe(docId);
    const download = await request(`/resources/${docId}/file?download=1`, cookieV);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await download.arrayBuffer()).equals(replacement)).toBe(true);
  }, 30000);
  it('rejects oversized and mismatched uploads without creating records', async () => {
    expect((await request('/admin/resources', cookieA, 'POST', form(data('document'), Buffer.from('bad'), 'fake.pdf'))).status).toBe(400);
    expect((await request('/admin/resources', cookieA, 'POST', form(data('document'), Buffer.alloc(MAX_RESOURCE_FILE + 1)))).status).toBe(400);
  }, 30000);
  it('accepts real DOCX packages and serves them only as private attachments', async () => {
    const word = wordFixture();
    expect(documentKind('GUIDE.DOCX', word).extension).toBe('docx');
    const res = await request('/admin/resources', cookieA, 'POST', form(data('document', { isPublished: true }), word, 'word-guide.docx'));
    expect(res.status).toBe(201);
    const dto = (await res.json()).resource;
    const download = await request(`/resources/${dto.id}/file`, cookieV);
    expect(download.headers.get('content-type')).toContain('wordprocessingml.document');
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await download.arrayBuffer()).equals(word)).toBe(true);
  }, 30000);
  it('requires full unique per-type reorder lists and persists the ordering', async () => {
    const docs = (await (await request('/admin/resources')).json()).filter((r: {type:string}) => r.type === 'document');
    const ids = docs.map((r: {id:string}) => r.id).reverse();
    await reorderResources('document', ids);
    const order = (await (await request('/admin/resources')).json()).filter((r: {type:string}) => r.type === 'document').map((r: {id:string}) => r.id);
    expect(order).toEqual(ids);
    await expect(reorderResources('document', [docId, docId])).rejects.toThrow('list changed');
  });
  it('limits operational quick links to active volunteers and rejects unsafe links', async () => {
    const link = await saveResource(admin, resourceInput.parse(data('link', { isQuickLink: true, isPublished: true })));
    expect((await (await request('/resources', cookieV)).json()).some((r:{id:string}) => r.id === link.resource.id)).toBe(true);
    await db.update(volunteerProfilesTable).set({ status: 'onboarding' }).where(eq(volunteerProfilesTable.userId, volunteer));
    expect((await (await request('/resources', cookieV)).json()).some((r:{id:string}) => r.id === link.resource.id)).toBe(false);
    expect((await request(`/resources/${link.resource.id}`, cookieV)).status).toBe(404);
    await db.update(volunteerProfilesTable).set({ status: 'active' }).where(eq(volunteerProfilesTable.userId, volunteer));
  });
  it('bumps agreements atomically, routes sign-in to renewal, and server-blocks old versions until acknowledged', async () => {
    for (const title of ['User Agreement', 'Safety Guidelines']) await saveResource(admin, resourceInput.parse(data('article', {
      title, category: 'Agreements', body: 'Temporary test agreement, not program policy.', isPublished: true })));
    const [agreement] = await db.select().from(resourcesTable).where(eq(resourcesTable.title, 'User Agreement'));
    const changed = await saveResource(admin, resourceInput.parse(data('article', { title: 'User Agreement', category: 'Agreements',
      body: 'Updated temporary test agreement.', isPublished: true, bumpAgreementVersion: true })), agreement!.id);
    testVersion = changed.agreementVersion; expect(testVersion).not.toBe(originalVersion);
    expect(changed.bumped).toBe(true);
    const session = await (await request('/auth/session', cookieV)).json(); expect(session.nextPath).toBe('/dashboard');
    const me = await (await request('/me', cookieV)).json(); expect(me.agreementRequired).toBe(false);
    expect(me.profile).not.toHaveProperty('adminNotes');
    expect((await request('/volunteer/schedule', cookieV)).status).toBe(200);
    expect((await request('/agreements/acknowledge', cookieV, 'POST', { version: originalVersion, acknowledged: true })).status).toBe(409);
    await acknowledgeAgreement(volunteer, testVersion);
    expect((await request('/volunteer/schedule', cookieV)).status).toBe(200);
    expect((await (await request('/me', cookieV)).json()).agreementRequired).toBe(false);
    expect((await (await request('/auth/session', cookieV)).json()).nextPath).toBe('/dashboard');
  });
  it('deletes with private file cleanup and makes prior download URLs unavailable', async () => {
    expect((await request(`/admin/resources/${docId}`, cookieA, 'DELETE')).status).toBe(200);
    expect((await request(`/resources/${docId}/file`, cookieV)).status).toBe(404);
  }, 30000);
});
