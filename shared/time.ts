import { appConfig } from './appConfig';

/** Accept Date objects at the storage boundary so local-time strings cannot slip in. */
export function toUtcTimestamp(date: Date): string {
  return date.toISOString();
}

/** All user-facing date/time formatting is explicitly Pacific, including DST. */
export function formatPacificDateTime(
  date: Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: appConfig.timezone,
  }).format(date);
}
