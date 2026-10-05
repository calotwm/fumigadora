import type { IsoDate, IsoMonth } from './types.js';

export const BUSINESS_TIMEZONE = 'America/Argentina/Buenos_Aires';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toUtc(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Current calendar date in the business timezone. Inject `now` in tests. */
export function today(now: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): IsoDate {
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Whole days from `b` to `a` (`a - b`). Positive when `a` is later. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(a) - toUtc(b)) / DAY_MS);
}

/** Adds calendar months, clamping the day to the end of the target month (Jan 31 + 1 = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const day = Math.min(d, daysInMonth(ty, tm));
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = parts(date);
  return `${date.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const from = `${month}-01`;
  return { from, to: endOfMonth(from) };
}

export function addMonthsToMonth(month: IsoMonth, delta: number): IsoMonth {
  return monthOf(addMonths(`${month}-01`, delta));
}

/** Last `count` months ending at `month` (inclusive), oldest first. */
export function lastMonths(month: IsoMonth, count: number): IsoMonth[] {
  return Array.from({ length: count }, (_, i) => addMonthsToMonth(month, i - (count - 1)));
}

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(toUtc(date)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function startOfWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function endOfWeek(date: IsoDate): IsoDate {
  return addDays(date, 7 - isoWeekday(date));
}

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `2025-03` -> `marzo 2025`. */
export function monthLabelEs(month: IsoMonth): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES_ES[Number(m) - 1] ?? month} ${y}`;
}
