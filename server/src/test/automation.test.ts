import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, isoWeekday } from '@fumigadora/shared';
import type { Deps } from '../http.js';
import type { MailProvider } from '../mail/provider.js';
import { maybeRunDailyJob } from '../services/jobs.js';
import { makeTestApp, type TestApp } from './helpers.js';

interface RouteItem {
  id: number;
  clientId: number;
  clientName: string;
  hasEmail: boolean;
  date: string;
  zone: string | null;
  visitId: number | null;
  assignedUserId: number | null;
  notice: { state: string; dueOn: string | null };
}

const flat = (route: { zones: { dates: { items: RouteItem[] }[] }[] }): RouteItem[] =>
  route.zones.flatMap((z) => z.dates.flatMap((d) => d.items));

describe('month route planner and service notices', () => {
  let t: TestApp;
  let service = 0;
  let employee = 0;
  const ids: Record<string, number> = {};
  const sentTo: string[] = [];

  async function client(key: string, body: Record<string, unknown>) {
    const res = await t.post('/api/clients', { serviceFrequency: 'monthly', defaultServiceTypeId: service, ...body });
    expect(res.status).toBe(201);
    ids[key] = res.body.id;
  }

  beforeAll(async () => {
    const mail: MailProvider = {
      mode: 'simulated',
      from: 'test',
      async sendEmail(m) {
        sentTo.push(m.to);
        return { providerId: null };
      },
    };
    t = await makeTestApp('2025-06-15', mail);
    service = (await t.post('/api/service-types', { name: 'Desinsectación' })).body.id;
    employee = (await t.post('/api/users', { name: 'Juan', username: 'juan', password: 'secret1' })).body.id;
    await client('a1', { name: 'A1 Con mail', area: 'Norte', email: 'a1@example.com' });
    await client('a2', { name: 'A2 Sin mail', area: 'Norte' });
    await client('b1', { name: 'B1 Con mail', area: 'Sur', email: 'b1@example.com' });
    await client('w', { name: 'W Semanal', area: 'Sur', serviceFrequency: 'weekly', email: 'w@example.com' });
    await client('sched', { name: 'S Ya agendado', area: 'Norte', email: 's@example.com' });
    await client('noplan', { name: 'Sin plan', area: 'Norte', serviceFrequency: 'none', email: 'np@example.com' });
    await client('nosvc', { name: 'Sin servicio', area: 'Sur', defaultServiceTypeId: null, email: 'ns@example.com' });
    await t.post('/api/visits', { clientId: ids.sched, serviceTypeId: service, date: '2025-07-10', frequency: 'monthly' });
  });
  afterAll(() => t.close());

  it('has no route until one is generated and rejects past months', async () => {
    const empty = await t.get('/api/routes/2025-07');
    expect(empty.status).toBe(200);
    expect(empty.body.plan).toBeNull();
    expect((await t.post('/api/routes/2025-05/generate')).status).toBe(400);
    expect((await t.get('/api/routes/julio')).status).toBe(400);
  });

  it('proposes dates per zone, skipping clients already scheduled, without plan or without service', async () => {
    const res = await t.post('/api/routes/2025-07/generate');
    expect(res.status).toBe(200);
    expect(res.body.plan.status).toBe('draft');
    expect(res.body.skipped).toEqual([{ clientId: ids.nosvc, name: 'Sin servicio', reason: 'Sin servicio habitual definido' }]);
    const items = flat(res.body);
    const names = items.map((i) => i.clientName);
    expect(names).not.toContain('S Ya agendado');
    expect(names).not.toContain('Sin plan');
    // a1, a2, b1 monthly (1 each) + weekly client (July 2025 has 4 Mondays)
    expect(items).toHaveLength(3 + 4);
    for (const zone of ['Norte', 'Sur']) {
      const weekdays = new Set(items.filter((i) => i.zone === zone).map((i) => isoWeekday(i.date)));
      expect(weekdays.size).toBe(1);
    }
    expect(res.body.totals).toMatchObject({ visits: 7, clients: 4, withEmail: 3, withoutEmail: 1 });
    expect(res.body.zones.map((z: { zone: string }) => z.zone)).toEqual(['Norte', 'Sur']);
  });

  it('regenerating a draft replaces its items; edits are validated', async () => {
    const first = flat((await t.get('/api/routes/2025-07')).body);
    const again = await t.post('/api/routes/2025-07/generate');
    expect(again.status).toBe(200);
    expect(flat(again.body)).toHaveLength(first.length);
    expect(flat(again.body).map((i) => i.id)).not.toEqual(first.map((i) => i.id));

    const a1 = flat(again.body).find((i) => i.clientId === ids.a1)!;
    expect((await t.patch(`/api/routes/items/${a1.id}`, { date: '2025-08-01' })).status).toBe(400);
    const patched = await t.patch(`/api/routes/items/${a1.id}`, { date: '2025-07-22', time: '10:30', assignedUserId: employee });
    expect(patched.status).toBe(200);
    expect(flat(patched.body).find((i) => i.id === a1.id)).toMatchObject({ date: '2025-07-22', time: '10:30', assignedUserId: employee });

    const weeklyItem = flat(patched.body).find((i) => i.clientId === ids.w)!;
    const removed = await t.del(`/api/routes/items/${weeklyItem.id}`);
    expect(flat(removed.body)).toHaveLength(first.length - 1);

    const added = await t.post('/api/routes/2025-07/items', { clientId: ids.sched, date: '2025-07-25' });
    expect(added.status).toBe(201);
    expect(flat(added.body).find((i) => i.clientId === ids.sched)).toMatchObject({ date: '2025-07-25', zone: 'Norte' });
    expect((await t.post('/api/routes/2025-07/items', { clientId: ids.nosvc, date: '2025-07-25' })).status).toBe(400);
  });

  it('approves into scheduled visits and logs one simulated notice per client with email', async () => {
    const before = flat((await t.get('/api/routes/2025-07')).body);
    const withEmail = before.filter((i) => i.hasEmail);
    const res = await t.post('/api/routes/2025-07/approve');
    expect(res.status).toBe(200);
    expect(res.body.plan.status).toBe('approved');
    expect(res.body.notices).toEqual({ sent: 0, simulated: withEmail.length, failed: 0 });

    const items = flat(res.body);
    expect(items.every((i) => i.visitId !== null)).toBe(true);
    expect(items.filter((i) => i.hasEmail).every((i) => i.notice.state === 'simulated')).toBe(true);
    expect(items.filter((i) => !i.hasEmail).every((i) => i.notice.state === 'no_email')).toBe(true);

    const visits = (await t.get('/api/visits?from=2025-07-01&to=2025-07-31&status=scheduled')).body as { id: number; assignedUserId: number | null; frequency: string; clientId: number }[];
    for (const item of items) expect(visits.find((v) => v.id === item.visitId)).toBeTruthy();
    expect(visits.find((v) => v.clientId === ids.a1)).toMatchObject({ assignedUserId: employee, frequency: 'monthly' });

    const log = await t.get('/api/email/log?kind=service_notice');
    expect(log.body.total).toBe(withEmail.length);
    expect(log.body.items.every((e: { status: string; refId: string }) => e.status === 'simulated' && e.refId === '2025-07')).toBe(true);
    const emailOf: Record<number, string> = { [ids.a1!]: 'a1', [ids.b1!]: 'b1', [ids.w!]: 'w', [ids.sched!]: 's' };
    expect([...sentTo].sort()).toEqual(withEmail.map((i) => `${emailOf[i.clientId]}@example.com`).sort());
    const detail = await t.get(`/api/email/log/${log.body.items[0].id}`);
    expect(detail.body.html).toContain('Su próximo servicio está programado');
  });

  it('refuses to regenerate or edit an approved route and does not send notices twice', async () => {
    expect((await t.post('/api/routes/2025-07/generate')).status).toBe(409);
    expect((await t.post('/api/routes/2025-07/approve')).status).toBe(409);
    const item = flat((await t.get('/api/routes/2025-07')).body)[0]!;
    expect((await t.patch(`/api/routes/items/${item.id}`, { time: '09:00' })).status).toBe(409);
    expect((await t.del(`/api/routes/items/${item.id}`)).status).toBe(409);
    const count = sentTo.length;
    const job = await t.post('/api/jobs/run-daily');
    expect(job.status).toBe(200);
    expect(job.body.notices).toEqual({ sent: 0, simulated: 0, failed: 0 });
    expect(sentTo).toHaveLength(count);
  });

  it('days_before mode schedules the notice and the daily job sends it when due, once', async () => {
    await t.call('PUT', '/api/settings', { noticeMode: 'days_before', noticeDaysBefore: 7 });
    await client('late', { name: 'L Tarde', area: 'Centro', email: 'late@example.com' });
    const generated = await t.post('/api/routes/2025-08/generate');
    expect(generated.status).toBe(200);
    const mine = flat(generated.body).find((i) => i.clientId === ids.late)!;
    const approved = await t.post('/api/routes/2025-08/approve');
    const item = flat(approved.body).find((i) => i.id === mine.id)!;
    expect(approved.body.notices.simulated).toBe(0);
    expect(item.notice).toMatchObject({ state: 'scheduled', dueOn: addDays(item.date, -7) });

    t.setToday(addDays(item.date, -8));
    expect((await t.post('/api/jobs/run-daily')).body.notices.simulated).toBe(0);
    t.setToday(addDays(item.date, -7));
    expect((await t.post('/api/jobs/run-daily')).body.notices.simulated).toBeGreaterThanOrEqual(1);
    expect((await t.post('/api/jobs/run-daily')).body.notices.simulated).toBe(0);
    const after = flat((await t.get('/api/routes/2025-08')).body).find((i) => i.id === item.id)!;
    expect(after.notice.state).toBe('simulated');
    t.setToday('2025-06-15');
  });
});

describe('failed mail', () => {
  it('stores the failure, keeps the visits and retries on the next run', async () => {
    let fail = true;
    const mail: MailProvider = {
      mode: 'resend',
      from: 'x',
      async sendEmail() {
        if (fail) throw new Error('boom');
        return { providerId: 'ok-1' };
      },
    };
    const t = await makeTestApp('2025-06-15', mail);
    const service = (await t.post('/api/service-types', { name: 'S' })).body.id;
    await t.post('/api/clients', { name: 'Cliente', area: 'Norte', email: 'c@example.com', serviceFrequency: 'monthly', defaultServiceTypeId: service });
    await t.post('/api/routes/2025-07/generate');
    const approved = await t.post('/api/routes/2025-07/approve');
    expect(approved.status).toBe(200);
    expect(approved.body.notices).toEqual({ sent: 0, simulated: 0, failed: 1 });
    expect(flat(approved.body)[0]!.notice.state).toBe('failed');
    expect((await t.get('/api/visits?status=scheduled')).body).toHaveLength(1);
    expect((await t.get('/api/email/log')).body.items[0]).toMatchObject({ status: 'failed', error: 'boom' });

    fail = false;
    const retry = await t.post('/api/jobs/run-daily');
    expect(retry.body.notices).toEqual({ sent: 1, simulated: 0, failed: 0 });
    expect(flat((await t.get('/api/routes/2025-07')).body)[0]!.notice.state).toBe('sent');
    await t.close();
  });
});

describe('debt reminders and the daily job', () => {
  let t: TestApp;
  const ids: Record<string, number> = {};

  async function debtor(key: string, body: Record<string, unknown>, dueOn: string) {
    const c = await t.post('/api/clients', { name: key, ...body });
    ids[key] = c.body.id;
    const inv = await t.post('/api/invoices', { clientId: c.body.id, amountCents: 100_000, issuedOn: addDays(dueOn, -10), dueOn });
    expect(inv.status).toBe(201);
  }

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    await debtor('Moroso', { email: 'moroso@example.com' }, '2025-05-10'); // 36 days overdue
    await debtor('Sin mail', {}, '2025-05-10');
    await debtor('Reciente', { email: 'reciente@example.com' }, '2025-06-10'); // 5 days overdue
    await debtor('Al dia', { email: 'aldia@example.com' }, '2025-07-10'); // not due yet
  });
  afterAll(() => t.close());

  const reminders = async () => (await t.get('/api/email/log?kind=debt_reminder')).body;

  it('does nothing while disabled, but previews who would get one', async () => {
    const preview = await t.get('/api/reminders/preview');
    expect(preview.body.enabled).toBe(false);
    expect(preview.body.recipients.map((r: { name: string }) => r.name)).toEqual(['Moroso']);
    expect(preview.body.skipped).toMatchObject({ no_email: 1, not_late_enough: 1 });
    const job = await t.post('/api/jobs/run-daily');
    expect(job.body.reminders).toEqual({ sent: 0, simulated: 0, failed: 0 });
    expect((await reminders()).total).toBe(0);
  });

  it('sends once per interval even if the job runs twice the same day', async () => {
    await t.call('PUT', '/api/settings', { debtRemindersEnabled: true, debtReminderEveryDays: 15, debtReminderMinDaysOverdue: 10 });
    const first = await t.post('/api/jobs/run-daily');
    expect(first.body.reminders).toEqual({ sent: 0, simulated: 1, failed: 0 });
    const second = await t.post('/api/jobs/run-daily');
    expect(second.body.reminders).toEqual({ sent: 0, simulated: 0, failed: 0 });
    const log = await reminders();
    expect(log.total).toBe(1);
    expect(log.items[0]).toMatchObject({ to: 'moroso@example.com', clientId: ids.Moroso, clientName: 'Moroso' });
    const html = (await t.get(`/api/email/log/${log.items[0].id}`)).body.html as string;
    expect(html).toContain('2025-');
    expect(html).toContain('desestime este mensaje');
    // Without the IPC warning switched on, the reminder says nothing about interest.
    expect(html).not.toContain('IPC');
  });

  it('waits the configured days before the next reminder and includes newly eligible clients', async () => {
    t.setToday('2025-06-29'); // 14 days later
    expect((await t.post('/api/jobs/run-daily')).body.reminders.simulated).toBe(1); // "Reciente" is now 19 days overdue
    t.setToday('2025-06-30'); // 15 days after the first reminder to Moroso
    const day15 = await t.post('/api/jobs/run-daily');
    expect(day15.body.reminders.simulated).toBe(1);
    expect((await reminders()).total).toBe(3);
  });

  it('manual send ignores the switch', async () => {
    await t.call('PUT', '/api/settings', { debtRemindersEnabled: false });
    t.setToday('2025-08-30');
    expect((await t.post('/api/jobs/run-daily')).body.reminders.simulated).toBe(0);
    const manual = await t.post('/api/reminders/send');
    expect(manual.body.simulated).toBe(3); // Moroso, Reciente and the now-overdue "Al dia"
  });

  it('warns that IPC interest will start after the grace days when the warning is on', async () => {
    const put = await t.call('PUT', '/api/settings', { ipcWarningEnabled: true, ipcWarningGraceDays: 10 });
    expect(put.body).toMatchObject({ ipcWarningEnabled: true, ipcWarningGraceDays: 10 });
    t.setToday('2025-09-20');
    const owedBefore = (await t.get('/api/receivables')).body.owedCents;
    expect((await t.post('/api/reminders/send')).body.simulated).toBe(3);
    const latest = (await reminders()).items[0];
    const html = (await t.get(`/api/email/log/${latest.id}`)).body.html as string;
    expect(html).toContain('30/09/2025'); // 2025-09-20 + 10 days
    expect(html).toContain('Índice de Precios al Consumidor (IPC)');
    // Debts are not changed by the warning.
    expect((await t.get('/api/receivables')).body.owedCents).toBe(owedBefore);
  });
});

describe('daily scheduler guard', () => {
  it('runs once per business day, only after 09:00 in Buenos Aires', async () => {
    const t = await makeTestApp('2025-06-15');
    const deps: Deps = { db: t.db, config: t.config, mail: t.mail, today: t.today };
    const early = new Date('2025-06-15T11:00:00Z'); // 08:00 in Buenos Aires
    const later = new Date('2025-06-15T13:00:00Z'); // 10:00
    expect(await maybeRunDailyJob(deps, early)).toBeNull();
    expect(await maybeRunDailyJob(deps, later)).toMatchObject({ date: '2025-06-15' });
    expect(await maybeRunDailyJob(deps, later)).toBeNull();
    t.setToday('2025-06-16');
    expect(await maybeRunDailyJob(deps, new Date('2025-06-16T13:00:00Z'))).not.toBeNull();
    await t.close();
  });
});
