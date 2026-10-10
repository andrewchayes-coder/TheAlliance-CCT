import { and, eq, inArray } from 'drizzle-orm';
import { db, notificationLogTable, type NotificationLog } from '@workspace/db';
import { isUncertainDelivery } from './delivery-state';

/** Filter first, rather than spending a bounded batch revisiting handled mail. */
export async function pendingRecipients<T extends { id: string }>(
  type: NotificationLog['type'], relatedId: string, recipients: T[],
): Promise<T[]> {
  if (!recipients.length) return [];
  const rows = await db.select({ userId: notificationLogTable.recipientUserId,
    status: notificationLogTable.status, error: notificationLogTable.error })
    .from(notificationLogTable).where(and(eq(notificationLogTable.type, type),
      eq(notificationLogTable.relatedId, relatedId), inArray(notificationLogTable.recipientUserId, recipients.map(r => r.id))));
  const handled = new Set(rows.filter(r => r.status === 'sent' || r.status === 'logged' || r.status === 'suppressed' || isUncertainDelivery(r.error))
    .map(r => r.userId));
  return recipients.filter(r => !handled.has(r.id));
}
