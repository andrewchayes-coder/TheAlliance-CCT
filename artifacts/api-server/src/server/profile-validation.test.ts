import { describe, expect, it } from 'vitest';
import { profileDraftSchema, volunteerProfileEditSchema, profileCompletionSchema } from '@workspace/shared/profileFields';

describe('NEW-07 shared draft and save validation', () => {
  it.each([
    ['zip', '1234'], ['zip', '123456'], ['zip', '12345-123'],
    ['phone', '12345'], ['phone', 'abc'], ['phone', 'abc5555550100'],
    ['emergencyContactPhone', '12345'], ['emergencyContactPhone', 'abc'],
    ['dateOfBirth', '2999-01-01'], ['dateOfBirth', '2025-02-30'],
    ['addressLine1', 'x'.repeat(301)], ['city', 'x'.repeat(101)],
    ['firstName', 'x'.repeat(101)], ['emergencyContactName', 'x'.repeat(201)],
    ['state', 'XX'],
  ])('rejects invalid %s', (key, value) => {
    const result = profileDraftSchema.safeParse({ [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty(key);
    if (key !== 'dateOfBirth') expect(volunteerProfileEditSchema.safeParse({ [key]: value }).success).toBe(false);
  });
  it('allows omitted, empty and null draft fields without treating a draft as complete', () => {
    expect(profileDraftSchema.parse({})).toEqual({});
    const draft = Object.fromEntries(Object.keys(profileDraftSchema.shape).map(key => [key, '']));
    expect(profileDraftSchema.safeParse(draft).success).toBe(true);
    expect(profileDraftSchema.safeParse(Object.fromEntries(Object.keys(draft).map(key => [key, null]))).success).toBe(true);
    expect(profileCompletionSchema.safeParse(draft).success).toBe(false);
  });
  it('accepts ZIP+4 and stores formatted US phones as ten digits', () => {
    expect(profileDraftSchema.parse({ zip: '95603-1234', phone: '+1 (555) 555-0100', emergencyContactPhone: '555-555-0101' }))
      .toEqual({ zip: '95603-1234', phone: '5555550100', emergencyContactPhone: '5555550101' });
  });
});
