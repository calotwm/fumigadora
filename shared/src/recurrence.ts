import { addDays, addMonths } from './dates.js';
import type { Frequency, IsoDate } from './types.js';

const MONTH_STEPS: Partial<Record<Frequency, number>> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

/**
 * Next visit date for a recurring service; null for `none`.
 * Month-based frequencies clamp to the end of shorter months (Jan 31 + monthly = Feb 28/29).
 */
export function nextVisitDate(date: IsoDate, frequency: Frequency): IsoDate | null {
  switch (frequency) {
    case 'none':
      return null;
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    default: {
      const step = MONTH_STEPS[frequency];
      return step === undefined ? null : addMonths(date, step);
    }
  }
}
