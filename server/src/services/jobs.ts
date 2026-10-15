import { eq } from 'drizzle-orm';
import { BUSINESS_TIMEZONE } from '@fumigadora/shared';
import { jobRuns } from '../db/schema.js';
import type { Deps } from '../http.js';
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

function localHour(now: Date): number {
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
  const runDate = deps.today();
  const [claim] = await deps.db.insert(jobRuns).values({ job: DAILY_JOB, runDate }).onConflictDoNothing().returning({ id: jobRuns.id });
  if (!claim) return null;
  try {
    const result = await runDailyJob(deps);
    await deps.db.update(jobRuns).set({ result }).where(eq(jobRuns.id, claim.id));
    return result;
  } catch (error) {
    // Release the claim so the next tick retries.
    await deps.db.delete(jobRuns).where(eq(jobRuns.id, claim.id));
    throw error;
  }
}

/** Checks hourly (and shortly after boot). Single-instance, in-process. */
export function startDailyScheduler(deps: Deps): () => void {
  const tick = () => {
    maybeRunDailyJob(deps)
      .then((result) => {
        if (result) console.log('[jobs] daily job done', JSON.stringify(result));
      })
      .catch((error) => console.error('[jobs] daily job failed', error));
  };
  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  return () => clearInterval(timer);
}
