import type { EmailLogType, NotificationSummary } from '@workspace/api-client-react';

export const TYPES: { type: EmailLogType; label: string; color: string }[] = [
  { type: 'verification', label: 'Verification', color: '#06365d' },
  { type: 'password_reset', label: 'Password reset', color: '#1a466b' },
  { type: 'welcome', label: 'Welcome', color: '#2c567b' },
  { type: 'shift', label: 'Shift', color: '#15749c' },
  { type: 'reminder', label: 'Reminder', color: '#3e668b' },
  { type: 'message', label: 'Message', color: '#50769b' },
  { type: 'admin_alert', label: 'Admin alert', color: '#385e7d' },
  { type: 'invite', label: 'Invite', color: '#6a869e' },
];
export const typeLabel = (t: string) => TYPES.find(x => x.type === t)?.label ?? t;
export const monthParts = (m: string) => { const [y, mo] = m.split('-').map(Number); return { y, mo }; };
export const monthName = (m: string, long = false) => {
  const { y, mo } = monthParts(m);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
export const countOf = (list: { type: string; count: number }[], t: string) => list.find(x => x.type === t)?.count ?? 0;
export type Summary = NotificationSummary;
export const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }); };
