export const volunteerCount = (count: number) => `${count} volunteer${count === 1 ? '' : 's'}`;
const assigned = (count: number) => `${volunteerCount(count)} ${count === 1 ? 'is' : 'are'} assigned`;
export const capacityHint = (count: number) => `${assigned(count)}, so capacity can't go below ${count}.`;
export const capacityError = (count: number) => `${assigned(count)}. Capacity cannot be reduced below ${count}; move or end assignments first.`;
/** A bounded assignment whose first and last dates match occurs exactly once. */
export const isOneTimeShift = (a: { startDate: string; endDate?: string | null }) =>
  !!a.endDate && a.startDate === a.endDate;
