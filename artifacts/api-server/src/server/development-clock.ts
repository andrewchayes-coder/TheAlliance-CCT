/** A caller-supplied clock is never trusted outside development. */
export function developmentClock(value: unknown): Date {
  if (value === undefined) return new Date();
  if (process.env.NODE_ENV !== 'development') throw new RangeError('Clock overrides are development-only.');
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new RangeError('Use a timestamp with an explicit time zone.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Choose a valid timestamp.');
  return date;
}
