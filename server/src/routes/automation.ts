import { Hono } from 'hono';
import type { Deps } from '../http.js';
import { runDailyJob } from '../services/jobs.js';
import { reminderPreview, sendDebtReminders } from '../services/reminders.js';

export function reminderRoutes(deps: Deps) {
  return new Hono()
    .get('/preview', async (c) => c.json(await reminderPreview(deps.db, deps.today())))
    .post('/send', async (c) => c.json(await sendDebtReminders(deps, true)));
}

export function jobRoutes(deps: Deps) {
  return new Hono().post('/run-daily', async (c) => c.json(await runDailyJob(deps)));
}
