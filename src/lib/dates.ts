import type { DateRange, ISODate, YearMonth } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_MS = 86_400_000;

const parts = (date: ISODate) => date.split('-').map(Number) as [number, number, number];
const toUtc = (date: ISODate) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysFrom(from: ISODate, to: ISODate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const [y, m] = parts(`${ym}-01`);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function lastDayOf(ym: YearMonth): ISODate {
  const [y, m] = parts(`${ym}-01`);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Whole month, clipped to `today` for the current month. */
export function monthRange(ym: YearMonth, today: ISODate): DateRange {
  const end = lastDayOf(ym);
  return { from: `${ym}-01`, to: end < today ? end : today };
}

/** Monday of the week containing `date`. */
export function weekStart(date: ISODate): ISODate {
  const [y, m, d] = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** 'long' = "October 2026", 'name' = "October", 'short' = "Oct". */
export function formatMonth(ym: YearMonth, style: 'short' | 'name' | 'long' = 'long') {
  const [y, m] = parts(`${ym}-01`);
  if (style === 'short') return MONTHS_SHORT[m - 1];
  return style === 'name' ? MONTHS_LONG[m - 1] : `${MONTHS_LONG[m - 1]} ${y}`;
}

/** The app's one date format: "Oct 14". */
export function formatShortDate(date: ISODate) {
  const [, m, d] = parts(date);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}
