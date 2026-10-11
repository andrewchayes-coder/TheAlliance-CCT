/**
 * Retained storage compatibility only, never new profile writes or visible labels.
 * Preserve existing enum ordinals and reuse earlier QA rows without duplicates.
 */
export const retiredVolunteerStatuses = ['applicant', 'in_training'] as const;
export const retiredTestAccountEmails = {
  ready: 'qa-vol-training@example.org',
  new: 'qa-vol-applicant@example.org',
} as const;
