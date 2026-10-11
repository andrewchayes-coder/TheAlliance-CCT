import { appConfig } from '@workspace/shared/appConfig';
import { testProfileFields } from '@workspace/shared/testAccounts';
import type {
  usersTable, volunteerProfilesTable, shiftSlotsTable, shiftAssignmentsTable, shiftSkipsTable,
  closedDatesTable, messagesTable, messageRecipientsTable, resourcesTable,
} from '@workspace/shared/schema';
import { addDays, documentFixtures, nextHoliday, nextOccurrence, seedId, todayPacific, weekday } from './seed-support';

const names = [
  ['Maya', 'Thompson'], ['Daniel', 'Reed'], ['Elena', 'Martinez'], ['Omar', 'Patel'],
  ['Sarah', 'Kim'], ['Marcus', 'Brooks'], ['Nina', 'Sullivan'], ['Chloe', 'Bennett'],
  ['Ethan', 'Carter'], ['Sofia', 'Nguyen'], ['Jordan', 'Hayes'], ['Isabel', 'Rivera'],
  ['Liam', "O'Connor"], ['Grace', 'Chen'], ['Noah', 'Anderson'], ['Ava', 'Mitchell'],
  ['Lucas', 'Torres'], ['Hannah', 'Wilson'],
] as const;
export const adminId = seedId('user:admin');

export function buildSeedFixtures(hashes: { admin: string; volunteers: string[] }, now = new Date()) {
  const today = todayPacific(now);
  const lastMonth = addDays(today, -30);
  const earlierInstant = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const users: (typeof usersTable.$inferInsert)[] = [{
    id: adminId, email: 'admin@example.org', passwordHash: hashes.admin,
    firstName: 'Alliance', lastName: 'Admin', phone: '+19165550100',
    role: 'admin', emailVerifiedAt: earlierInstant, isActive: true, lastLoginAt: now,
  }];
  const profiles: (typeof volunteerProfilesTable.$inferInsert)[] = names.map(([firstName, lastName], index) => {
    const key = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '');
    const userId = seedId(`user:${key}`);
    const status = index < 7 ? 'onboarding' : index < 17 ? 'active' : 'inactive';
    const isComplete = status === 'active' || status === 'inactive' || index === 6;
    users.push({
      id: userId, email: `${key}@example.org`, passwordHash: hashes.volunteers[index]!,
      firstName, lastName, phone: `+1530555${String(101 + index).padStart(4, '0')}`,
      role: 'volunteer', isActive: status !== 'inactive',
      emailVerifiedAt: index < 2 ? null : earlierInstant,
      lastLoginAt: index < 4 ? null : earlierInstant,
    });
    return {
      id: seedId(`profile:${key}`), userId,
      county: index === 3 ? appConfig.counties[1] : index === 14 ? appConfig.counties[2] : appConfig.defaultCounty,
      status,
      ...(isComplete ? testProfileFields : {}),
      startDate: status === 'active' ? lastMonth : null,
      onboardingAnswers: {},
      onboardingCompletedAt: isComplete ? earlierInstant : null,
      availabilityNotes: index % 2 === 0 ? 'Mornings are usually best.' : 'Flexible on weekday afternoons.',
      certificationStatus: isComplete ? 'complete' : index >= 4 ? 'in_progress' : 'not_started',
      certificationCompletedAt: isComplete ? lastMonth : null,
      certificationExpiresAt: isComplete ? addDays(today, status === 'inactive' ? -7 : 335) : null,
      backgroundCheckStatus: status === 'active' || status === 'inactive' || index === 6
        ? 'cleared' : index === 3 ? 'not_cleared' : index === 0 ? 'not_started' : 'pending',
      backgroundCheckSubmittedAt: index === 0 ? null : lastMonth,
      backgroundCheckClearedAt: status === 'active' || status === 'inactive' || index === 6 ? addDays(lastMonth, 7) : null,
      agreementAcknowledgedAt: null,
      agreementVersion: null,
      adminNotes: 'Dummy development record. This staff-only note must not appear in volunteer responses.',
    };
  });

  const slots: (typeof shiftSlotsTable.$inferInsert)[] = [];
  const timePairs = Array.from({length:8},(_,hour)=>[`${String(hour+9).padStart(2,'0')}:00`,`${String(hour+11).padStart(2,'0')}:00`]);
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  for (let day = 1; day <= 5; day++) {
    for (const [startTime, endTime] of timePairs) {
      slots.push({
        id: seedId(`slot:${day}:${startTime}`), dayOfWeek: day, startTime, endTime,
        capacity: 2, label: `${dayNames[day - 1]} ${startTime}–${endTime}`, isActive: true,
      });
    }
  }
  const startDate = addDays(today, 1 - weekday(today));
  const primarySlots = [0, 2, 4, 8, 10, 12, 16, 18, 20, 24];
  const secondSlots = [2, 0, 6, 26, 28, 32, 34, 36];
  const activeProfiles = profiles.filter(profile => profile.status === 'active');
  const assignments: (typeof shiftAssignmentsTable.$inferInsert)[] = [];
  activeProfiles.forEach((profile, index) => {
    const indices = [primarySlots[index]!];
    if (index < secondSlots.length && appConfig.maxShiftsPerVolunteer >= 2) indices.push(secondSlots[index]!);
    for (const slotIndex of indices) {
      const slot = slots[slotIndex]!;
      assignments.push({
        id: seedId(`assignment:${profile.id}:${slot.id}`),
        volunteerProfileId: profile.id!, shiftSlotId: slot.id!, startDate,
        endDate: null, createdByUserId: adminId, endedReason: null,
      });
    }
  });
  const holiday = nextHoliday(today);
  const skips: (typeof shiftSkipsTable.$inferInsert)[] = [assignments[0]!, assignments[10]!].map((assignment, index) => {
    const slot = slots.find(value => value.id === assignment.shiftSlotId)!;
    let skipDate = addDays(nextOccurrence(today, slot.dayOfWeek), 7 * (index + 1));
    if (skipDate === holiday.date) skipDate = addDays(skipDate, 7);
    return { id: seedId(`skip:${index}`), shiftAssignmentId: assignment.id!, skipDate };
  });
  const closedDates: (typeof closedDatesTable.$inferInsert)[] = [{
    id: seedId('closed-date:next-holiday'), ...holiday,
  }];

  const messages: (typeof messagesTable.$inferInsert)[] = [{
    id: seedId('message:welcome'), senderUserId: adminId, audience: 'all',
    subject: 'Welcome to the community care team',
    body: 'Thank you for showing up for our neighbors. This is a **dummy welcome message** for development.',
    sentByEmail: false, sentAt: earlierInstant,
  }, {
    id: seedId('message:individual'), senderUserId: adminId, audience: 'single',
    subject: 'A note about your standing shifts',
    body: 'This is a dummy individual message. Your sample standing shifts are ready to review when scheduling features are added.',
    sentByEmail: false, sentAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  }];
  const recipients: (typeof messageRecipientsTable.$inferInsert)[] = profiles.map((profile, index) => ({
    id: seedId(`recipient:welcome:${profile.userId}`), messageId: messages[0]!.id!,
    recipientUserId: profile.userId, readAt: index % 3 === 0 ? now : null,
  }));
  recipients.push({
    id: seedId('recipient:individual'), messageId: messages[1]!.id!,
    recipientUserId: activeProfiles[0]!.userId, readAt: null,
  });

  const resources: (typeof resourcesTable.$inferInsert)[] = documentFixtures.map((fixture, index) => ({
    id: seedId(`resource:${fixture.key}`), type: 'document', title: fixture.title,
    summary: 'Development placeholder PDF, not Alliance program guidance.', category: 'Volunteer essentials',
    fileKey: `seed-resources/${fixture.key}.pdf`, fileName: `${fixture.key}.pdf`, fileMimeType: 'application/pdf',
    isQuickLink: false, sortOrder: index + 1, isPublished: true, createdByUserId: adminId,
  }));
  ['Getting ready for a phone shift', 'Listening with care', 'Finding community resources'].forEach((title, index) => {
    resources.push({
      id: seedId(`resource:article:${index}`), type: 'article', title,
      summary: 'A sample article for reviewing the resource data model.', category: 'Learning',
      body: `# ${title}\n\nThis is **dummy content** for development only. Approved Alliance guidance will be added later.`,
      isQuickLink: false, sortOrder: index + 4, isPublished: true, createdByUserId: adminId,
    });
  });
  [
    { title: 'Log in to Find Help', url: 'https://find-help.example.org/login', quick: true },
    { title: 'Open Phone Portal', url: 'https://phone-portal.example.org', quick: true },
    { title: 'Placer County resource directory', url: 'https://resources.example.org/placer', quick: false },
  ].forEach((link, index) => {
    resources.push({
      id: seedId(`resource:link:${index}`), type: 'link', title: link.title,
      summary: 'Placeholder URL for development only.', category: 'Useful links', url: link.url,
      isQuickLink: link.quick, sortOrder: index + 7, isPublished: true, createdByUserId: adminId,
    });
  });
  return { users, profiles, slots, assignments, skips, closedDates, messages, recipients, resources };
}
