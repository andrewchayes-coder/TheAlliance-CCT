import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, resourcesTable } from '@workspace/db';
import { MAX_RESOURCE_FILE, uploadResourceFile, deleteResourceFile, resourceFileStream } from '../server/resource-files';
import { resourceInput, resourceDto, resourceContext, visibleResources, resourceForActor, saveResource,
  publishResource, removeResource, reorderResources } from '../server/resources';
import { acknowledgeAgreement } from '../server/agreements';
import { ResourceError } from '../server/resource-error';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESOURCE_FILE, files: 1, fields: 1, fieldSize: 100000 } });
const uuid = z.string().uuid();
const wrap = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    const known = error instanceof ResourceError || error instanceof z.ZodError || error instanceof SyntaxError;
    if (!known) req.log.error({ err: error }, 'Resource request failed');
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof SyntaxError
      ? 'The resource details are not valid JSON.' : error instanceof ResourceError ? error.message : 'The resource could not be loaded or saved. Please try again.';
    res.status(error instanceof ResourceError ? error.status : known ? 400 : 500).json({ error: message });
  }
};
router.get('/admin/resources/context', wrap(async (_req, res) => { res.set('Cache-Control', 'no-store').json(await resourceContext()); }));
router.get('/admin/resources', wrap(async (req, res) => { res.set('Cache-Control', 'no-store').json(await visibleResources(req.authUser!.id, true)); }));
router.get('/resources', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await visibleResources(req.authUser!.id, req.authUser!.role === 'admin'));
}));
router.get('/resources/:id', wrap(async (req, res) => {
  const row = await resourceForActor(uuid.parse(req.params.id), req.authUser!.id, req.authUser!.role === 'admin');
  if (!row) { res.status(404).json({ error: 'This resource is not available.' }); return; }
  res.set('Cache-Control', 'no-store').json(resourceDto(row));
}));
const save = wrap(async (req, res) => {
  let file: Awaited<ReturnType<typeof uploadResourceFile>> | undefined;
  let saved = false;
  try {
    const input = resourceInput.parse(req.is('multipart/form-data') ? JSON.parse(req.body.metadata ?? '{}') : req.body);
    const id = req.params.id ? uuid.parse(req.params.id) : undefined;
    if (req.file && input.type !== 'document') { res.status(400).json({ error: 'Only documents accept file uploads.' }); return; }
    if (id && !await resourceForActor(id, req.authUser!.id, true)) { res.status(404).json({ error: 'This resource no longer exists.' }); return; }
    if (req.file) file = await uploadResourceFile(req.file.originalname, req.file.buffer);
    const result = await saveResource(req.authUser!.id, input, id, file);
    saved = true;
    res.status(id ? 200 : 201).json(result);
  } catch (error) {
    if (file && !saved) await deleteResourceFile(file.fileKey).catch(() => req.log.warn('An unused uploaded resource file needs cleanup.'));
    throw error;
  }
});
const multipart: RequestHandler = (req, res, next) => upload.single('file')(req, res, error => {
  if (error) { res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be no larger than 15 MB.' : 'Upload one PDF or DOCX with resource details.' }); return; }
  next();
});
router.post('/admin/resources', multipart, save);
router.patch('/admin/resources/:id', multipart, save);
router.patch('/admin/resources/:id/publish', wrap(async (req, res) => {
  const body = z.object({ isPublished: z.boolean() }).strict().parse(req.body);
  res.json(await publishResource(uuid.parse(req.params.id), body.isPublished, req.authUser!.id));
}));
router.post('/admin/resources/reorder', wrap(async (req, res) => {
  const body = z.object({ type: z.enum(['article', 'document', 'link']), ids: z.array(uuid).max(5000) }).strict().parse(req.body);
  await reorderResources(body.type, body.ids); res.json({ ok: true });
}));
router.delete('/admin/resources/:id', wrap(async (req, res) => {
  await removeResource(uuid.parse(req.params.id)); res.json({ ok: true });
}));
router.post('/agreements/acknowledge', wrap(async (req, res) => {
  const body = z.object({ version: z.string().min(1).max(200), acknowledged: z.literal(true) }).strict().parse(req.body);
  res.json(await acknowledgeAgreement(req.authUser!.id, body.version));
}));
router.get('/resources/:id/file', wrap(async (req, res) => {
  let row = await resourceForActor(uuid.parse(req.params.id), req.authUser!.id, req.authUser!.role === 'admin');
  if (!row || row.type !== 'document' || !row.fileKey) { res.status(404).json({ error: "This document isn't available right now." }); return; }
  // Local development placeholders must never be upgraded or uploaded in production.
  if (/^seed-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(row.fileKey)) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ResourceError("This document isn't available right now.", 404);
    }
    const legacyKey = row.fileKey;
    const name = legacyKey.split('/').pop()!;
    const bytes = await readFile(resolve(process.cwd(), 'seed-resources', name)).catch(() => {
      throw new ResourceError("This document isn't available right now.", 404);
    });
    const file = await uploadResourceFile(name, bytes);
    const [updated] = await db.update(resourcesTable).set({ ...file }).where(and(eq(resourcesTable.id, row.id), eq(resourcesTable.fileKey, legacyKey))).returning();
    if (updated) row = updated;
    else { await deleteResourceFile(file.fileKey); row = (await resourceForActor(row.id, req.authUser!.id, req.authUser!.role === 'admin'))!; }
    if (!row) { res.status(404).json({ error: 'This document is no longer available.' }); return; }
  }
  let stream: ReturnType<typeof resourceFileStream>;
  try { stream = resourceFileStream(row.fileKey!); }
  catch { throw new ResourceError("This document isn't available right now.", 404); }
  const filename = row.fileName || 'document.pdf';
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const disposition = row.fileMimeType === 'application/pdf' && req.query.download !== '1' ? 'inline' : 'attachment';
  res.set({ 'Content-Type': row.fileMimeType || 'application/octet-stream', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}` });
  stream.once('error', () => {
    if (res.headersSent) res.destroy();
    else { res.removeHeader('Content-Disposition'); res.status(404).type('json').json({ error: "This document isn't available right now." }); }
  });
  stream.pipe(res);
}));
export default router;
