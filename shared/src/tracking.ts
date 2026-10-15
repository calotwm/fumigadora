import { addMonths, daysInMonth, diffDays, endOfMonth, isoWeekday, monthRange } from './dates.js';
import type { Frequency, IsoDate, IsoMonth } from './types.js';

const MONTH_INTERVALS: Partial<Record<Frequency, number>> = {
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

/** Number of Mondays in the month (4 or 5). A weekly plan expects one service per week starting in the month. */
export function mondaysInMonth(month: IsoMonth): number {
  const [year, mo] = month.split('-').map(Number) as [number, number];
  const total = daysInMonth(year, mo);
  let count = 0;
  for (let day = 1; day <= total; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (isoWeekday(date) === 1) count++;
  }
  return count;
}

/**
 * How many services a client on `frequency` should receive in `month`.
 *
 * - `none`: 0 (not tracked).
 * - `weekly`: one per Monday of the month (4 or 5), so a 5-Monday month expects 5.
 * - `biweekly`: 2. `monthly`: 1.
 * - `bimonthly`/`quarterly`/`semiannual`/`yearly`: 1 when the service is due in the month, 0 otherwise.
 *   Due means never done, or `lastDoneBefore + interval` falls on or before the last day of the month.
 *   `lastDoneBefore` is the last done service strictly before the month starts (a service done inside the
 *   month must not push the due date out of that same month).
 */
export function expectedServicesInMonth(frequency: Frequency, month: IsoMonth, lastDoneBefore?: IsoDate | null): number {
  switch (frequency) {
    case 'none':
      return 0;
    case 'weekly':
      return mondaysInMonth(month);
    case 'biweekly':
      return 2;
    case 'monthly':
      return 1;
    default: {
      const interval = MONTH_INTERVALS[frequency];
      if (interval === undefined) return 0;
      if (!lastDoneBefore) return 1;
      return addMonths(lastDoneBefore, interval) <= endOfMonth(`${month}-01`) ? 1 : 0;
    }
  }
}

export interface MonthlyTrackingInput {
  frequency: Frequency;
  month: IsoMonth;
  today: IsoDate;
  /** Dates (in any month) of done services of the plan; the function filters by month itself. */
  doneDates: IsoDate[];
  /** Dates of scheduled (not yet done) services; only those inside the month are counted. */
  scheduledDates: IsoDate[];
}

export interface MonthlyTrackingStatus {
  expected: number;
  /** Done services inside the month, capped at `expected` for progress purposes. */
  done: number;
  /** Scheduled services inside the month that cover part of what is pending. */
  scheduled: number;
  /** `expected - done` (never negative). */
  pending: number;
  /** Pending and not covered by a scheduled visit. */
  pendingUnscheduled: number;
  /** The month still needs at least one service. */
  isDue: boolean;
  lastDoneOn: IsoDate | null;
  daysSinceLast: number | null;
}

/** Pure per-client status for the monthly tracking board. */
export function monthlyTrackingStatus(input: MonthlyTrackingInput): MonthlyTrackingStatus {
  const { from, to } = monthRange(input.month);
  const inMonth = (d: IsoDate) => d >= from && d <= to;
  const doneAll = input.doneDates.filter((d) => d <= input.today).sort();
  const doneBefore = doneAll.filter((d) => d < from);
  const doneInMonth = doneAll.filter(inMonth);
  const expected = expectedServicesInMonth(input.frequency, input.month, doneBefore[doneBefore.length - 1] ?? null);
  const done = Math.min(doneInMonth.length, expected);
  const pending = Math.max(0, expected - done);
  const scheduledInMonth = input.scheduledDates.filter(inMonth).length;
  const scheduled = Math.min(scheduledInMonth, pending);
  const lastDoneOn = doneAll[doneAll.length - 1] ?? null;
  return {
    expected,
    done,
    scheduled,
    pending,
    pendingUnscheduled: pending - scheduled,
    isDue: pending > 0,
    lastDoneOn,
    daysSinceLast: lastDoneOn ? Math.max(0, diffDays(input.today, lastDoneOn)) : null,
  };
}
