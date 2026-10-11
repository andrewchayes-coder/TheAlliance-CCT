/** The only built-in QA identities. No passwords or access keys belong here. */
export const testProfileFields = {
  dateOfBirth: '1990-01-01', addressLine1: '123 Test St', city: 'Auburn', state: 'CA', zip: '95603',
  emergencyContactName: 'Test Contact', emergencyContactRelationship: 'Friend', emergencyContactPhone: '5555550100',
} as const;
export const testAccounts = [
  { key: 'admin', label: 'Test Admin', description: 'Explore the staff tools with a QA administrator.', lastName: 'Admin', role: 'admin', email: 'qa-admin@example.org', ...testProfileFields },
  { key: 'vol-active', label: 'Test Volunteer Active', lastName: 'Active', role: 'volunteer', email: 'qa-vol-active@example.org',
    description: 'Approved volunteer; a standing shift is provided in development when there is room.',
    status: 'active', onboardingComplete: true, ...testProfileFields },
  { key: 'vol-active-noshift', label: 'Test Volunteer Active — No Shift', lastName: 'Active (No Shift)', role: 'volunteer', email: 'qa-vol-active-noshift@example.org',
    description: 'Approved volunteer ready to choose a first weekly shift.',
    status: 'active', onboardingComplete: true, ...testProfileFields },
  { key: 'vol-onboarding-ready', label: 'Volunteer · Onboarding, ready to activate', lastName: 'Onboarding (Ready)', role: 'volunteer',
    email: 'qa-vol-onboarding-ready@example.org', legacyEmail: 'qa-vol-training@example.org',
    description: 'Profile complete; awaiting Alliance approval.',
    status: 'onboarding', onboardingComplete: true, ...testProfileFields },
  { key: 'vol-onboarding-new', label: 'Volunteer · Onboarding, new', lastName: 'Onboarding (New)', role: 'volunteer',
    email: 'qa-vol-onboarding-new@example.org', legacyEmail: 'qa-vol-applicant@example.org',
    description: 'Verified new account ready to complete a profile.',
    status: 'onboarding', onboardingComplete: false },
] as const;
export type TestAccountKey = typeof testAccounts[number]['key'];
