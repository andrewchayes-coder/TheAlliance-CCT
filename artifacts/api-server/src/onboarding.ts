import { and, desc, eq } from 'drizzle-orm';
import { db, resourcesTable, usersTable, volunteerProfilesTable, userPublicSchema, volunteerProfilePublicColumns } from '@workspace/db';
import { onboardingQuestions, formatOnboardingAnswer } from '@workspace/shared/onboardingQuestions';
import { createEmailTemplate } from './email-template';
import { sendEmail } from './email';
import { appOrigin } from './auth/session';
import type { User } from '@workspace/db';
import { agreementVersion } from './server/agreements';

const titles = ['user agreement', 'safety guidelines'];
export function safeResourceHref(resource: typeof resourcesTable.$inferSelect): string | null {
  if (resource.type === 'article') return null;
  if (resource.type === 'document' && /^seed-resources\/[a-zA-Z0-9._-]+\.pdf$/.test(resource.fileKey ?? '')) {
    return `/api/resources/${resource.id}/file`;
  }
  if (resource.type === 'document') return /^private\/resources\/[\w.-]+$/.test(resource.fileKey ?? '')
    ? `/api/resources/${resource.id}/file` : null;
  const candidate = resource.url;
  try {
    const url = new URL(candidate ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function publishedAgreements() {
  const rows = await db.select().from(resourcesTable).where(and(
    eq(resourcesTable.category, 'Agreements'), eq(resourcesTable.isPublished, true),
  )).orderBy(desc(resourcesTable.updatedAt), resourcesTable.id);
  const selected = titles.map(title => rows.find(row => row.title.trim().toLowerCase() === title)).filter(row => !!row);
  const resources = selected.map(row => ({ id: row.id, title: row.title, type: row.type,
    body: row.type === 'article' ? row.body : null, href: safeResourceHref(row), fileName: row.fileName, fileMimeType: row.fileMimeType }));
  return { version: await agreementVersion(), resources,
    ready: resources.length === titles.length && resources.every(row => row.type === 'article' ? !!row.body?.trim() : !!row.href) };
}

export async function onboardingAccount(userId: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== 'volunteer') return null;
  const [profile] = await db.select(volunteerProfilePublicColumns).from(volunteerProfilesTable)
    .where(eq(volunteerProfilesTable.userId, userId));
  return { user: userPublicSchema.parse(user), role: user.role, verified: !!user.emailVerifiedAt, profile: profile ?? null };
}

export async function sendWelcome(user: User, profileId: string) {
  const content = createEmailTemplate({
    heading: 'Thank you for joining our volunteer team',
    firstName: user.firstName,
    paragraphs: [
      'Thank you for helping local families find the support they need. We have received your volunteer questionnaire and agreement acknowledgment.',
      "Here's what happens next: our team will reach out about training and a background check. Once you're approved, you'll pick your weekly shift.",
      'We appreciate the time and care you are bringing to this work. You can check your progress in the volunteer portal.',
    ],
    cta: { label: 'Visit your dashboard', url: `${appOrigin}/dashboard` },
  });
  return sendEmail({ type: 'welcome', to: user.email, toUserId: user.id, subject: 'Welcome to The Alliance volunteer team', relatedId: profileId, ...content });
}

/** Neutralize spreadsheet formulas in every cell, including user-generated names/answers. */
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportOnboardingCsv() {
  const rows = await db.select({ user: usersTable, profile: volunteerProfilesTable }).from(usersTable)
    .leftJoin(volunteerProfilesTable, eq(usersTable.id, volunteerProfilesTable.userId))
    .where(eq(usersTable.role, 'volunteer')).orderBy(usersTable.lastName, usersTable.firstName, usersTable.id);
  const headers = ['First name', 'Last name', 'Email', 'Phone', 'County', 'Status', 'Onboarding completed at', 'Agreement acknowledged at', 'Agreement version', ...onboardingQuestions.map(q => q.label)];
  const records = rows.map(({ user, profile }) => [user.firstName, user.lastName, user.email, user.phone, profile?.county,
    profile?.status, profile?.onboardingCompletedAt?.toISOString(), profile?.agreementAcknowledgedAt?.toISOString(),
    profile?.agreementVersion, ...onboardingQuestions.map(q => formatOnboardingAnswer(profile?.onboardingAnswers[q.id]))]);
  return '\ufeff' + [headers, ...records].map(record => record.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
