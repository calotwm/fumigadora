import { diffDays } from './dates.js';
import type { IsoDate } from './types.js';

export interface ReminderRules {
  enabled: boolean;
  /** Minimum days between two reminders to the same client. */
  everyDays: number;
  /** The oldest overdue invoice must be at least this many days past due. */
  minDaysOverdue: number;
}

export interface ReminderCandidate {
  email: string | null;
  /** Overdue balance of the client (positive = owes). */
  overdueCents: number;
  /** Days past due of the oldest overdue invoice. */
  daysOverdue: number;
  /** Business date of the last reminder sent (or simulated) to this client. */
  lastReminderOn: IsoDate | null;
}

export type ReminderSkipReason = 'disabled' | 'no_email' | 'not_overdue' | 'not_late_enough' | 'too_recent';

export const DEFAULT_REMINDER_RULES: ReminderRules = { enabled: false, everyDays: 15, minDaysOverdue: 10 };

/** Pure eligibility rule for a debt reminder. */
export function reminderDecision(
  candidate: ReminderCandidate,
  rules: ReminderRules,
  today: IsoDate,
): { send: true } | { send: false; reason: ReminderSkipReason } {
  if (!rules.enabled) return { send: false, reason: 'disabled' };
  if (!candidate.email || candidate.email.trim() === '') return { send: false, reason: 'no_email' };
  if (candidate.overdueCents <= 0) return { send: false, reason: 'not_overdue' };
  if (candidate.daysOverdue < rules.minDaysOverdue) return { send: false, reason: 'not_late_enough' };
  if (candidate.lastReminderOn && diffDays(today, candidate.lastReminderOn) < rules.everyDays) {
    return { send: false, reason: 'too_recent' };
  }
  return { send: true };
}
