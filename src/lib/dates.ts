import type { DateRange, ISODate, YearMonth } from '@/types';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (date: ISODate) => date.split('-').map(Number) as [number, number, number];

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
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

export function formatMonth(ym: YearMonth, style: 'short' | 'long' = 'long') {
  const [y, m] = parts(`${ym}-01`);
  return style === 'long' ? `${MONTHS_LONG[m - 1]} ${y}` : MONTHS_SHORT[m - 1];
}

/** "Oct 22" */
export function formatShortDate(date: ISODate) {
  const [, m, d] = parts(date);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "Thu, Oct 22, 2026" */
export function formatLongDate(date: ISODate) {
  const [y, m, d] = parts(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}
