/**
 * Servio date/time utilities (src/common/date/date.util.ts)
 *
 * Model
 *  - INSTANT: a JS Date (UTC moment). Stored in Postgres as timestamptz.
 *  - YMD: a calendar date string "YYYY-MM-DD" with no timezone. Used for business
 *    dates, report ranges and API params. Stored in Postgres as @db.Date, which
 *    Prisma reads/writes as a Date at 00:00:00.000 UTC (toDbDate / fromDbDate).
 *  - BUSINESS DATE: the trading day an instant belongs to, in the restaurant's
 *    timezone, with an optional rollover hour so a restaurant open past midnight
 *    keeps 00:30 on the previous trading day (rolloverHour = 4 → day starts 04:00).
 *  - No external dependencies: timezone maths uses Intl.DateTimeFormat.
 *    Works for any IANA zone (including ones with DST); Port Moresby is UTC+10 with no DST.
 *  - Pure functions. "now" is always injectable for tests.
 *
 * Throws DateError (map to HTTP 422/400 in the global exception filter).
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" calendar date, no timezone. */
export type Ymd = string;

export interface YmdParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface ZonedParts extends YmdParts {
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** [start, end): start inclusive, end exclusive. */
export interface InstantRange {
  start: Date;
  end: Date;
}

export type DateErrorCode =
  | 'INVALID_YMD'
  | 'INVALID_DATE'
  | 'INVALID_TIMEZONE'
  | 'INVALID_RANGE'
  | 'INVALID_ROLLOVER'
  | 'INVALID_INPUT';

export class DateError extends Error {
  constructor(message: string, readonly code: DateErrorCode) {
    super(message);
    this.name = 'DateError';
  }
}

export const DEFAULT_TIMEZONE = 'Pacific/Port_Moresby';
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Validation ───────────────────────────────────────────────────────────────

export function assertValidDate(value: unknown, label = 'date'): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DateError(`${label} must be a valid Date`, 'INVALID_DATE');
  }
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz: unknown): asserts tz is string {
  if (!isValidTimeZone(tz)) throw new DateError(`invalid IANA timezone "${String(tz)}"`, 'INVALID_TIMEZONE');
}

/** Rollover hour: integer 0-12 (0 = calendar midnight). */
export function assertRolloverHour(hour: unknown): asserts hour is number {
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 12) {
    throw new DateError('rolloverHour must be an integer between 0 and 12', 'INVALID_ROLLOVER');
  }
}

// ── YMD (calendar date strings) ──────────────────────────────────────────────

export function buildYmd(year: number, month: number, day: number): Ymd {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseYmd(ymd: string): YmdParts {
  const m = typeof ymd === 'string' ? YMD_RE.exec(ymd) : null;
  if (!m) throw new DateError(`invalid date "${String(ymd)}", expected YYYY-MM-DD`, 'INVALID_YMD');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900) throw new DateError(`year out of range in "${ymd}"`, 'INVALID_YMD');
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new DateError(`"${ymd}" is not a real calendar date`, 'INVALID_YMD');
  }
  return { year, month, day };
}

export function isValidYmd(value: unknown): value is Ymd {
  if (typeof value !== 'string') return false;
  try {
    parseYmd(value);
    return true;
  } catch {
    return false;
  }
}

function ymdToUtcMs(ymd: Ymd): number {
  const { year, month, day } = parseYmd(ymd);
  return Date.UTC(year, month - 1, day);
}

function utcMsToYmd(ms: number): Ymd {
  const d = new Date(ms);
  return buildYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  if (!Number.isInteger(days)) throw new DateError('days must be an integer', 'INVALID_INPUT');
  return utcMsToYmd(ymdToUtcMs(ymd) + days * MS_PER_DAY);
}

/** b - a in whole calendar days (negative if b is before a). */
export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / MS_PER_DAY);
}

export function compareYmd(a: Ymd, b: Ymd): number {
  const x = ymdToUtcMs(a);
  const y = ymdToUtcMs(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfYmd(ymd: Ymd): number {
  return new Date(ymdToUtcMs(ymd)).getUTCDay();
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: Ymd, to: Ymd): Ymd[] {
  const count = daysBetween(from, to);
  if (count < 0) throw new DateError('from must not be after to', 'INVALID_RANGE');
  return Array.from({ length: count + 1 }, (_, i) => addDaysYmd(from, i));
}

/** Start of the week containing `ymd`. weekStartsOn: 0 = Sunday, 1 = Monday (default). */
export function startOfWeekYmd(ymd: Ymd, weekStartsOn = 1): Ymd {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new DateError('weekStartsOn must be 0-6', 'INVALID_INPUT');
  }
  const offset = (weekdayOfYmd(ymd) - weekStartsOn + 7) % 7;
  return addDaysYmd(ymd, -offset);
}

export function startOfMonthYmd(ymd: Ymd): Ymd {
  const { year, month } = parseYmd(ymd);
  return buildYmd(year, month, 1);
}

export function endOfMonthYmd(ymd: Ymd): Ymd {
  const { year, month } = parseYmd(ymd);
  return buildYmd(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
}

/**
 * Validate a report range from API params.
 * Rejects bad dates, from > to, and ranges longer than maxDays (inclusive).
 */
export function normalizeRange(from: string, to: string, opts: { maxDays?: number } = {}): { from: Ymd; to: Ymd; days: number } {
  const { maxDays = 366 } = opts;
  parseYmd(from);
  parseYmd(to);
  const days = daysBetween(from, to) + 1;
  if (days < 1) throw new DateError('from must not be after to', 'INVALID_RANGE');
  if (days > maxDays) throw new DateError(`range must not exceed ${maxDays} days`, 'INVALID_RANGE');
  return { from, to, days };
}

// ── Prisma @db.Date bridge ───────────────────────────────────────────────────

/** "2026-10-07" → Date(2026-10-07T00:00:00.000Z), the value Prisma expects for @db.Date. */
export function toDbDate(ymd: Ymd): Date {
  return new Date(ymdToUtcMs(ymd));
}

/** Date from a @db.Date column (UTC midnight) → "YYYY-MM-DD". Never use local getters here. */
export function fromDbDate(date: Date): Ymd {
  assertValidDate(date, 'db date');
  return utcMsToYmd(date.getTime());
}

// ── Timezone maths (Intl only) ───────────────────────────────────────────────

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    assertTimeZone(tz);
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in the given timezone. */
export function getZonedParts(instant: Date, tz: string = DEFAULT_TIMEZONE): ZonedParts {
  assertValidDate(instant, 'instant');
  const bag: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') bag[p.type] = Number(p.value);
  }
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: bag.hour === 24 ? 0 : bag.hour, // some engines emit 24 at midnight
    minute: bag.minute,
    second: bag.second,
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (Port Moresby = 600). */
export function getTimeZoneOffsetMinutes(instant: Date, tz: string = DEFAULT_TIMEZONE): number {
  const p = getZonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instantSeconds = Math.floor(instant.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
  return (asUtc - instantSeconds) / MS_PER_MINUTE;
}

/** Wall-clock time in `tz` → the instant it happens. DST-safe (two-pass). */
export function zonedTimeToInstant(
  parts: YmdParts & Partial<Pick<ZonedParts, 'hour' | 'minute' | 'second'>>,
  tz: string = DEFAULT_TIMEZONE,
): Date {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(naive), tz) * MS_PER_MINUTE;
  let result = naive - firstOffset;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(result), tz) * MS_PER_MINUTE;
  if (secondOffset !== firstOffset) result = naive - secondOffset;
  return new Date(result);
}

// ── Business date and day ranges ─────────────────────────────────────────────

/** Calendar date of an instant in `tz` (ignores rollover). */
export function localYmd(instant: Date, tz: string = DEFAULT_TIMEZONE): Ymd {
  const p = getZonedParts(instant, tz);
  return buildYmd(p.year, p.month, p.day);
}

/**
 * The trading day an instant belongs to.
 * rolloverHour = 4: 2026-10-08 01:30 local → business date 2026-10-07.
 */
export function businessDateFor(instant: Date, tz: string = DEFAULT_TIMEZONE, rolloverHour = 0): Ymd {
  assertRolloverHour(rolloverHour);
  const p = getZonedParts(instant, tz);
  const ymd = buildYmd(p.year, p.month, p.day);
  return p.hour < rolloverHour ? addDaysYmd(ymd, -1) : ymd;
}

/** Instants covered by a business date: [start, end). Length is 24h except across DST changes. */
export function businessDayRange(businessDate: Ymd, tz: string = DEFAULT_TIMEZONE, rolloverHour = 0): InstantRange {
  assertRolloverHour(rolloverHour);
  const start = zonedTimeToInstant({ ...parseYmd(businessDate), hour: rolloverHour }, tz);
  const end = zonedTimeToInstant({ ...parseYmd(addDaysYmd(businessDate, 1)), hour: rolloverHour }, tz);
  return { start, end };
}

/** Instants covered by business dates from..to inclusive: [start of from, end of to). */
export function businessRange(from: Ymd, to: Ymd, tz: string = DEFAULT_TIMEZONE, rolloverHour = 0): InstantRange {
  if (compareYmd(from, to) > 0) throw new DateError('from must not be after to', 'INVALID_RANGE');
  return {
    start: businessDayRange(from, tz, rolloverHour).start,
    end: businessDayRange(to, tz, rolloverHour).end,
  };
}

/** Today's business date. */
export function currentBusinessDate(tz: string = DEFAULT_TIMEZONE, rolloverHour = 0, now: Date = new Date()): Ymd {
  return businessDateFor(now, tz, rolloverHour);
}

// ── Instant arithmetic (elapsed time, expiry) ────────────────────────────────

export function addSeconds(date: Date, n: number): Date {
  assertValidDate(date);
  return new Date(date.getTime() + n * MS_PER_SECOND);
}
export function addMinutes(date: Date, n: number): Date {
  assertValidDate(date);
  return new Date(date.getTime() + n * MS_PER_MINUTE);
}
export function addHours(date: Date, n: number): Date {
  assertValidDate(date);
  return new Date(date.getTime() + n * MS_PER_HOUR);
}

/** expiresAt <= now. Used for approval tokens, sessions, idempotency keys. */
export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  assertValidDate(expiresAt, 'expiresAt');
  return expiresAt.getTime() <= now.getTime();
}

/** Whole seconds until `date` (rounded up), never negative. Handy for Redis TTLs. */
export function secondsUntil(date: Date, now: Date = new Date()): number {
  assertValidDate(date);
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / MS_PER_SECOND));
}

/** Milliseconds elapsed since `from`, never negative. */
export function elapsedMs(from: Date, now: Date = new Date()): number {
  assertValidDate(from, 'from');
  return Math.max(0, now.getTime() - from.getTime());
}

/**
 * Offline sync: a device clock can be wrong. Future timestamps beyond the
 * allowed skew are replaced with server time; past timestamps are kept
 * (queued orders legitimately arrive late).
 */
export function clampToServerTime(
  clientTime: Date | undefined | null,
  serverNow: Date = new Date(),
  maxFutureSkewMs = 5 * MS_PER_MINUTE,
): { at: Date; adjusted: boolean } {
  if (!(clientTime instanceof Date) || Number.isNaN(clientTime.getTime())) return { at: serverNow, adjusted: true };
  if (clientTime.getTime() > serverNow.getTime() + maxFutureSkewMs) return { at: serverNow, adjusted: true };
  return { at: clientTime, adjusted: false };
}

// ── KDS timers ───────────────────────────────────────────────────────────────

/** 425000 → "7:05"; 3900000 → "1h 05m". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new DateError('elapsed time must be a non-negative number', 'INVALID_INPUT');
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  if (totalSeconds < 3600) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export type TicketSeverity = 'ok' | 'warning' | 'late';

/** Colour state for a kitchen ticket. Thresholds are placeholders: take them from restaurant settings. */
export function ticketAgeSeverity(
  ageMs: number,
  thresholds: { warnAfterMs?: number; lateAfterMs?: number } = {},
): TicketSeverity {
  const { warnAfterMs = 10 * MS_PER_MINUTE, lateAfterMs = 15 * MS_PER_MINUTE } = thresholds;
  if (ageMs >= lateAfterMs) return 'late';
  if (ageMs >= warnAfterMs) return 'warning';
  return 'ok';
}

// ── Display formatting (UI and receipts only) ────────────────────────────────

function intl(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat('en', options);
  }
}

/** "7 Oct 2026, 1:30 am" in the restaurant's timezone. */
export function formatDateTime(
  instant: Date,
  tz: string = DEFAULT_TIMEZONE,
  locale = 'en-PG',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  assertValidDate(instant, 'instant');
  assertTimeZone(tz);
  return intl(locale, { ...options, timeZone: tz }).format(instant);
}

/** "1:30 am" in the restaurant's timezone. */
export function formatTime(instant: Date, tz: string = DEFAULT_TIMEZONE, locale = 'en-PG'): string {
  return formatDateTime(instant, tz, locale, { hour: 'numeric', minute: '2-digit' });
}

/** Display a business date ("Wed, 7 Oct 2026") without any timezone shifting. */
export function formatBusinessDate(
  ymd: Ymd,
  locale = 'en-PG',
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const { year, month, day } = parseYmd(ymd);
  return intl(locale, { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}