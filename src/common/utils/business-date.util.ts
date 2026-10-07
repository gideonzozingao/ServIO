/**
 * Business date = the trading day an order belongs to. Restaurants trade past midnight,
 * so anything before `rolloverHour` (local time) counts as the previous day.
 */
export interface BusinessDate {
  iso: string; // YYYY-MM-DD
  date: Date; // UTC midnight, for @db.Date columns
}

export function businessDateFor(
  now: Date,
  timezone: string,
  rolloverHour = 4,
): BusinessDate {
  const shifted = new Date(now.getTime() - rolloverHour * 3_600_000);
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
  return { iso, date: isoToDbDate(iso) };
}

export function isoToDbDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function dbDateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = isoToDbDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dbDateToIso(d);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
