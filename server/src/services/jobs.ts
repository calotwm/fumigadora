import { eq } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@fumigadora/shared';
import { jobRuns } from '../db/schema.js';
import type { Deps } from '../http.js';
import {
  runAfternoonNotifications,
  runEveningNotifications,
  runMorningNotifications,
} from './notificationJobs.js';
import { sendDebtReminders } from './reminders.js';
import { sendDueNotices } from './routePlans.js';

export const DAILY_JOB = 'daily';
/** The daily job runs once per business day, from this local hour on. */
export const DAILY_HOUR = 9;

/** Service notices that became due, then debt reminders. Safe to run more than once a day: both are idempotent. */
export async function runDailyJob(deps: Deps) {
  const notices = await sendDueNotices(deps);
  const reminders = await sendDebtReminders(deps);
  return { date: deps.today(), notices, reminders };
}

export function localHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(hour);
}

/**
 * Scheduler tick: runs the daily job when it is past 09:00 in Buenos Aires and no run is recorded for today.
 * The `job_runs` row is claimed before running (unique per job and day), so restarts and overlapping ticks never double-run.
 * Returns null when it did not run.
 */
export async function maybeRunDailyJob(deps: Deps, now: Date = new Date()) {
  if (localHour(now) < DAILY_HOUR) return null;
  return runClaimed(deps, DAILY_JOB, () => runDailyJob(deps));
}

/** Claims today's `job_runs` row for `job` and runs it; a failure releases the claim. Null when already claimed. */
async function runClaimed<T extends object>(deps: Deps, job: string, run: () => Promise<T>): Promise<T | null> {
  const runDate = deps.today();
  const [claim] = await deps.db.insert(jobRuns).values({ job, runDate }).onConflictDoNothing().returning({ id: jobRuns.id });
  if (!claim) return null;
  try {
    const result = await run();
    await deps.db.update(jobRuns).set({ result }).where(eq(jobRuns.id, claim.id));
    return result;
  } catch (error) {
    // Release the claim so the next tick retries.
    await deps.db.delete(jobRuns).where(eq(jobRuns.id, claim.id));
    throw error;
  }
}

/**
 * Time-slotted notification jobs, each claimed once per business day in `job_runs`. A slot runs from its hour on
 * (a restart later in the day still catches up); the afternoon reminder is moot once the evening slot opens.
 */
export const NOTIFICATION_SLOTS: readonly { job: string; fromHour: number; untilHour: number; run: (deps: Deps) => Promise<object> }[] = [
  { job: 'notify_morning', fromHour: 9, untilHour: 24, run: runMorningNotifications },
  { job: 'notify_afternoon', fromHour: 17, untilHour: 20, run: runAfternoonNotifications },
  { job: 'notify_evening', fromHour: 20, untilHour: 24, run: runEveningNotifications },
];

/** Runs the notification slots that are due at `now`; returns the results keyed by job (slots already claimed are left out). */
export async function maybeRunNotificationJobs(deps: Deps, now: Date = new Date()) {
  const hour = localHour(now);
  const results: Record<string, object> = {};
  for (const slot of NOTIFICATION_SLOTS) {
    if (hour < slot.fromHour || hour >= slot.untilHour) continue;
    const result = await runClaimed(deps, slot.job, () => slot.run(deps));
    if (result) results[slot.job] = result;
  }
  return results;
}

/** Checks hourly (and shortly after boot). Single-instance, in-process. */
export function startDailyScheduler(deps: Deps): () => void {
  const tick = () => {
    maybeRunDailyJob(deps)
      .then((result) => {
        if (result) console.log('[jobs] daily job done', JSON.stringify(result));
      })
      .catch((error) => console.error('[jobs] daily job failed', error));
    maybeRunNotificationJobs(deps)
      .then((results) => {
        if (Object.keys(results).length > 0) console.log('[jobs] notifications done', JSON.stringify(results));
      })
      .catch((error) => console.error('[jobs] notifications failed', error));
  };
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return () => clearInterval(timer);
}
