import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateError, isValidYmd, parseYmd, addDaysYmd, daysBetween, compareYmd, weekdayOfYmd, eachDay,
  startOfWeekYmd, startOfMonthYmd, endOfMonthYmd, normalizeRange, toDbDate, fromDbDate,
  getZonedParts, getTimeZoneOffsetMinutes, zonedTimeToInstant, localYmd, businessDateFor,
  businessDayRange, businessRange, currentBusinessDate, addMinutes, addHours, addSeconds,
  isExpired, secondsUntil, elapsedMs, clampToServerTime, formatElapsed, ticketAgeSeverity,
  formatTime, formatDateTime, formatBusinessDate, isValidTimeZone, MS_PER_HOUR,
} from './date.utils.js';

const POM = 'Pacific/Port_Moresby';

test('ymd validation and parsing', () => {
  assert.equal(isValidYmd('2028-02-29'), true);
  assert.equal(isValidYmd('2026-02-29'), false);
  assert.equal(isValidYmd('2026-13-01'), false);
  assert.equal(isValidYmd('26-01-01'), false);
  assert.equal(isValidYmd(20261007), false);
  assert.deepEqual(parseYmd('2026-10-07'), { year: 2026, month: 10, day: 7 });
  assert.throws(() => parseYmd('2026-02-30'), { code: 'INVALID_YMD' });
});

test('ymd arithmetic', () => {
  assert.equal(addDaysYmd('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysYmd('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysYmd('2028-02-28', 1), '2028-02-29');
  assert.equal(daysBetween('2026-10-01', '2026-10-07'), 6);
  assert.equal(daysBetween('2026-10-07', '2026-10-01'), -6);
  assert.equal(compareYmd('2026-10-01', '2026-10-02'), -1);
  assert.equal(weekdayOfYmd('2026-10-07'), 3); // Wednesday
  assert.deepEqual(eachDay('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.throws(() => eachDay('2026-10-02', '2026-10-01'), { code: 'INVALID_RANGE' });
  assert.equal(startOfWeekYmd('2026-10-07'), '2026-10-05'); // Monday
  assert.equal(startOfWeekYmd('2026-10-07', 0), '2026-10-04'); // Sunday
  assert.equal(startOfMonthYmd('2026-10-17'), '2026-10-01');
  assert.equal(endOfMonthYmd('2026-10-17'), '2026-10-31');
  assert.equal(endOfMonthYmd('2028-02-15'), '2028-02-29');
});

test('report range validation', () => {
  assert.deepEqual(normalizeRange('2026-10-01', '2026-10-07'), { from: '2026-10-01', to: '2026-10-07', days: 7 });
  assert.throws(() => normalizeRange('2026-10-07', '2026-10-01'), { code: 'INVALID_RANGE' });
  assert.throws(() => normalizeRange('2026-01-01', '2026-12-31', { maxDays: 90 }), { code: 'INVALID_RANGE' });
  assert.throws(() => normalizeRange('nope', '2026-10-01'), { code: 'INVALID_YMD' });
});

test('prisma @db.Date bridge', () => {
  assert.equal(toDbDate('2026-10-07').toISOString(), '2026-10-07T00:00:00.000Z');
  assert.equal(fromDbDate(new Date('2026-10-07T00:00:00.000Z')), '2026-10-07');
  assert.equal(fromDbDate(toDbDate('2028-02-29')), '2028-02-29');
});

test('timezone maths: Port Moresby is UTC+10', () => {
  const instant = new Date('2026-10-07T15:30:00Z');
  assert.equal(getTimeZoneOffsetMinutes(instant, POM), 600);
  assert.deepEqual(getZonedParts(instant, POM), { year: 2026, month: 10, day: 8, hour: 1, minute: 30, second: 0 });
  assert.equal(localYmd(instant, POM), '2026-10-08');
  assert.equal(isValidTimeZone(POM), true);
  assert.equal(isValidTimeZone('Mars/Phobos'), false);
  assert.throws(() => getZonedParts(instant, 'Mars/Phobos'), { code: 'INVALID_TIMEZONE' });
});

test('zonedTimeToInstant round-trips, including DST zones', () => {
  const p = { year: 2026, month: 10, day: 8, hour: 1, minute: 30, second: 0 };
  assert.equal(zonedTimeToInstant(p, POM).toISOString(), '2026-10-07T15:30:00.000Z');
  for (const tz of ['America/New_York', 'Europe/London', 'Australia/Sydney', POM]) {
    for (const q of [
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0, second: 0 },
      { year: 2026, month: 7, day: 15, hour: 23, minute: 59, second: 59 },
      { year: 2026, month: 11, day: 1, hour: 12, minute: 0, second: 0 },
    ]) {
      assert.deepEqual(getZonedParts(zonedTimeToInstant(q, tz), tz), q, `${tz} ${JSON.stringify(q)}`);
    }
  }
});

test('business date with rollover', () => {
  const instant = new Date('2026-10-07T15:30:00Z'); // 2026-10-08 01:30 in Port Moresby
  assert.equal(businessDateFor(instant, POM, 0), '2026-10-08');
  assert.equal(businessDateFor(instant, POM, 4), '2026-10-07');
  assert.equal(businessDateFor(new Date('2026-10-07T18:00:00Z'), POM, 4), '2026-10-08'); // 04:00 local exactly
  assert.equal(currentBusinessDate(POM, 0, instant), '2026-10-08');
  assert.throws(() => businessDateFor(instant, POM, 13), { code: 'INVALID_ROLLOVER' });
});

test('business day ranges', () => {
  const r0 = businessDayRange('2026-10-07', POM, 0);
  assert.equal(r0.start.toISOString(), '2026-10-06T14:00:00.000Z');
  assert.equal(r0.end.toISOString(), '2026-10-07T14:00:00.000Z');

  const r4 = businessDayRange('2026-10-07', POM, 4);
  assert.equal(r4.start.toISOString(), '2026-10-06T18:00:00.000Z');
  assert.equal(r4.end.toISOString(), '2026-10-07T18:00:00.000Z');

  const wk = businessRange('2026-10-05', '2026-10-11', POM, 0);
  assert.equal((wk.end.getTime() - wk.start.getTime()) / MS_PER_HOUR, 7 * 24);

  // DST zones: 23h and 25h days
  const ny = (d: string) => {
    const r = businessDayRange(d, 'America/New_York', 0);
    return (r.end.getTime() - r.start.getTime()) / MS_PER_HOUR;
  };
  assert.equal(ny('2026-03-08'), 23);
  assert.equal(ny('2026-11-01'), 25);
  assert.equal(ny('2026-06-15'), 24);

  assert.throws(() => businessRange('2026-10-07', '2026-10-01'), { code: 'INVALID_RANGE' });
});

test('instant arithmetic and expiry', () => {
  const t = new Date('2026-10-07T00:00:00Z');
  assert.equal(addMinutes(t, 1).toISOString(), '2026-10-07T00:01:00.000Z');
  assert.equal(addHours(t, 12).toISOString(), '2026-10-07T12:00:00.000Z');
  assert.equal(addSeconds(t, 60).toISOString(), '2026-10-07T00:01:00.000Z');
  assert.equal(isExpired(addSeconds(t, 60), t), false);
  assert.equal(isExpired(t, t), true);
  assert.equal(secondsUntil(addSeconds(t, 59.2), t), 60);
  assert.equal(secondsUntil(addSeconds(t, -10), t), 0);
  assert.equal(elapsedMs(addSeconds(t, 90), addSeconds(t, 30)), 0);
  assert.equal(elapsedMs(t, addSeconds(t, 30)), 30_000);
  assert.throws(() => addMinutes(new Date('nope'), 1), { code: 'INVALID_DATE' });
});

test('client clock clamping for offline orders', () => {
  const now = new Date('2026-10-07T10:00:00Z');
  assert.deepEqual(clampToServerTime(new Date('2026-10-05T10:00:00Z'), now), { at: new Date('2026-10-05T10:00:00Z'), adjusted: false });
  assert.deepEqual(clampToServerTime(new Date('2026-10-07T10:03:00Z'), now), { at: new Date('2026-10-07T10:03:00Z'), adjusted: false });
  assert.deepEqual(clampToServerTime(new Date('2026-10-07T11:00:00Z'), now), { at: now, adjusted: true });
  assert.deepEqual(clampToServerTime(undefined, now), { at: now, adjusted: true });
  assert.deepEqual(clampToServerTime(new Date('garbage'), now), { at: now, adjusted: true });
});

test('KDS timers', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(425_000), '7:05');
  assert.equal(formatElapsed(3_599_000), '59:59');
  assert.equal(formatElapsed(3_900_000), '1h 05m');
  assert.throws(() => formatElapsed(-1), DateError);
  assert.equal(ticketAgeSeverity(5 * 60_000), 'ok');
  assert.equal(ticketAgeSeverity(10 * 60_000), 'warning');
  assert.equal(ticketAgeSeverity(15 * 60_000), 'late');
  assert.equal(ticketAgeSeverity(60_000, { warnAfterMs: 30_000, lateAfterMs: 90_000 }), 'warning');
});

test('display formatting', () => {
  const instant = new Date('2026-10-07T15:30:00Z');
  assert.match(formatTime(instant, POM), /1:30/);
  assert.match(formatDateTime(instant, POM), /8 Oct 2026/);
  assert.match(formatBusinessDate('2026-10-07'), /Wed/);
  assert.match(formatBusinessDate('2026-10-07'), /7 Oct 2026/);
});