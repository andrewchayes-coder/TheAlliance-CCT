/** The only built-in QA identities. No passwords or access keys belong here. */
export const testAccounts = [
  { key: 'admin', label: 'Test Admin', description: 'Explore the staff tools with a QA administrator.', lastName: 'Admin', role: 'admin', email: 'qa-admin@example.org' },
  { key: 'vol-active', label: 'Test Volunteer Active', lastName: 'Active', role: 'volunteer', email: 'qa-vol-active@example.org',
    description: 'Approved volunteer; a standing shift is provided in development when there is room.',
    status: 'active', onboardingComplete: true, certificationStatus: 'complete', backgroundCheckStatus: 'cleared' },
  { key: 'vol-active-noshift', label: 'Test Volunteer Active — No Shift', lastName: 'Active (No Shift)', role: 'volunteer', email: 'qa-vol-active-noshift@example.org',
    description: 'Approved volunteer ready to choose a first weekly shift.',
    status: 'active', onboardingComplete: true, certificationStatus: 'complete', backgroundCheckStatus: 'cleared' },
  { key: 'vol-training', label: 'Test Volunteer In Training', lastName: 'In Training', role: 'volunteer', email: 'qa-vol-training@example.org',
    description: 'Onboarding complete; training and background check are in progress.',
    status: 'in_training', onboardingComplete: true, certificationStatus: 'in_progress', backgroundCheckStatus: 'pending' },
  { key: 'vol-applicant', label: 'Test Volunteer Applicant', lastName: 'Applicant', role: 'volunteer', email: 'qa-vol-applicant@example.org',
    description: 'Verified new applicant who still needs to complete onboarding.',
    status: 'applicant', onboardingComplete: false, certificationStatus: 'not_started', backgroundCheckStatus: 'not_started' },
] as const;
export type TestAccountKey = typeof testAccounts[number]['key'];
