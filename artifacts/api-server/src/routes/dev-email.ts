import { randomUUID } from 'node:crypto';
import { Router, type IRouter } from 'express';
import { eq } from 'drizzle-orm';
import { db, notificationLogTable } from '@workspace/db';
import { TestDevEmailResponse, type DevEmailCheckError } from '@workspace/api-zod';
import { createEmailTemplate, sendEmail } from '../email';

const router: IRouter = Router();
const checkError = (error: string): DevEmailCheckError => ({ ok: false, error });

// Fixed recipient/content: this is not an unauthenticated email-sending API.
router.post('/dev/email-test', async (req, res): Promise<void> => {
  if (process.env.NODE_ENV !== 'development') {
    res.status(404).json(checkError('Not found.'));
    return;
  }
  if (process.env.POSTMARK_SERVER_TOKEN?.trim() && process.env.EMAIL_FROM?.trim()) {
    res.status(409).json(checkError('Live email delivery is configured. This check only runs in console-logging mode.'));
    return;
  }

  const relatedId = `dev-email-test:${randomUUID()}`;
  const content = createEmailTemplate({
    heading: 'Thank you for being part of The Alliance',
    paragraphs: [
      'Thank you for the time and care you share with our community.',
      'This is a development check of the volunteer portal email service. It does not change any volunteer account or send a real email.',
    ],
    cta: { label: 'Open the example test link', url: `https://example.org/volunteer-email-check?test=${relatedId}` },
  });
  const result = await sendEmail({
    type: 'admin_alert',
    to: 'email-test@example.org',
    subject: 'Alliance email service — development check',
    relatedId,
    ...content,
  });
  if (!result.ok) {
    res.status(500).json(checkError(result.error ?? 'The development email check failed.'));
    return;
  }

  try {
    const [row] = await db.select({
      logId: notificationLogTable.id,
      status: notificationLogTable.status,
      relatedId: notificationLogTable.relatedId,
    }).from(notificationLogTable).where(eq(notificationLogTable.relatedId, relatedId)).limit(1);
    if (!row || row.status !== 'logged') {
      res.status(500).json(checkError('The expected logged notification row was not found.'));
      return;
    }
    res.json(TestDevEmailResponse.parse({ ok: true, ...row }));
  } catch (error) {
    req.log.error({ err: error }, 'Could not confirm the development email audit row');
    res.status(500).json(checkError('Could not confirm the development email audit row.'));
  }
});

export default router;
