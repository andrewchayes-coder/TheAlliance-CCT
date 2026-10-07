import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { appConfig } from '@workspace/shared/appConfig';

// Stable UUID v5 IDs make reruns safe without deleting or resetting any records.
export function seedId(key: string): string {
  const namespace = Buffer.from('c5d1d8a139c64b858a9cec7ea9ecb128', 'hex');
  const bytes = createHash('sha1').update(namespace).update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashSeedPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifySeedPassword(password: string, encoded: string): boolean {
  const [algorithm, n, r, p, salt, hash] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

export function todayPacific(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: appConfig.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

export function nextOccurrence(today: string, dayOfWeek: number): string {
  return addDays(today, (dayOfWeek - weekday(today) + 7) % 7);
}

function nthWeekday(year: number, month: number, day: number, occurrence: number): string {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  return addDays(first, (day - weekday(first) + 7) % 7 + (occurrence - 1) * 7);
}

function observed(date: string): string {
  const day = weekday(date);
  return addDays(date, day === 6 ? -1 : day === 7 ? 1 : 0);
}

/** Dummy closure only: this is not a policy decision about Alliance holidays. */
export function nextHoliday(today: string): { date: string; reason: string } {
  const currentYear = Number(today.slice(0, 4));
  const holidays: { date: string; reason: string }[] = [];
  for (const year of [currentYear, currentYear + 1]) {
    const memorialLastDay = `${year}-05-31`;
    holidays.push(
      { date: observed(`${year}-01-01`), reason: "New Year's Day" },
      { date: nthWeekday(year, 1, 1, 3), reason: 'Martin Luther King Jr. Day' },
      { date: nthWeekday(year, 2, 1, 3), reason: "Presidents' Day" },
      { date: addDays(memorialLastDay, -((weekday(memorialLastDay) - 1 + 7) % 7)), reason: 'Memorial Day' },
      { date: observed(`${year}-06-19`), reason: 'Juneteenth' },
      { date: observed(`${year}-07-04`), reason: 'Independence Day' },
      { date: nthWeekday(year, 9, 1, 1), reason: 'Labor Day' },
      { date: nthWeekday(year, 10, 1, 2), reason: "Indigenous Peoples' Day / Columbus Day" },
      { date: observed(`${year}-11-11`), reason: 'Veterans Day' },
      { date: nthWeekday(year, 11, 4, 4), reason: 'Thanksgiving' },
      { date: observed(`${year}-12-25`), reason: 'Christmas Day' },
    );
  }
  return holidays.filter(holiday => holiday.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]!;
}

export const documentFixtures = [
  { key: 'volunteer-handbook', title: 'Volunteer handbook' },
  { key: 'phone-shift-checklist', title: 'Phone shift checklist' },
  { key: 'community-resource-guide', title: 'Community resource guide' },
];

/** Small valid PDFs, clearly labelled dummy content; no invented program guidance. */
export async function writeSeedDocuments(): Promise<void> {
  const directory = resolve(import.meta.dirname, '../..', 'artifacts/alliance-volunteer-portal/public/seed-resources');
  await mkdir(directory, { recursive: true });
  for (const fixture of documentFixtures) {
    const text = `${fixture.title} - Development placeholder`;
    const stream = `BT /F1 18 Tf 50 740 Td (${text}) Tj 0 -36 Td /F1 11 Tf (Dummy document for development. Not Alliance program guidance.) Tj ET`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    await writeFile(resolve(directory, `${fixture.key}.pdf`), pdf);
  }
}
