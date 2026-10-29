import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { emailLog, jobRuns, notifications, payments } from '../db/schema.js';
import type { Deps } from '../http.js';
import type { MailProvider } from '../mail/provider.js';
import { sendLogged } from '../services/mail.js';
import { maybeRunNotificationJobs } from '../services/jobs.js';
import { makeTestApp, type TestApp } from './helpers.js';

// 2025-06-15 in Buenos Aires (UTC-3).
const EARLY = new Date('2025-06-15T11:00:00Z'); // 08:00
const MORNING = new Date('2025-06-15T13:00:00Z'); // 10:00
const AFTERNOON = new Date('2025-06-15T20:30:00Z'); // 17:30
const EVENING = new Date('2025-06-15T23:30:00Z'); // 20:30

describe('notification jobs', () => {
  let t: TestApp;
  let deps: Deps;
  let juanId: number;
  let pabloId: number;
  let duenaId: number;
  let sinMailId: number;

  const inbox = (userId: number, kind: string) =>
    t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind as 'day_summary')));
  const ownerMails = () => t.db.select().from(emailLog).where(eq(emailLog.kind, 'owner_notification'));

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    deps = { db: t.db, config: t.config, mail: t.mail, today: t.today };
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
    duenaId = (await t.post('/api/users', { name: 'Dueña Prueba', username: 'duena', password: 'secreto3', role: 'admin', email: 'duena@example.com' })).body.id;
    sinMailId = (await t.post('/api/users', { name: 'Socio Sin Mail', username: 'socio', password: 'secreto4', role: 'admin' })).body.id;
    // An inactive admin hears nothing.
    const baja = await t.post('/api/users', { name: 'Admin de Baja', username: 'baja', password: 'secreto5', role: 'admin', email: 'baja@example.com' });
    await t.patch(`/api/users/${baja.body.id}`, { active: false });

    const clientId = (await t.post('/api/clients', { name: 'Cliente Uno', phone: '1155551111', address: 'Calle 1' })).body.id;
    const serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    const visit = (extra: Record<string, unknown>) => t.post('/api/visits', { clientId, serviceTypeId: serviceId, ...extra });
    await visit({ date: '2025-06-15', time: '11:00', assignedUserId: juanId });
    await visit({ date: '2025-06-15', time: '09:30', assignedUserId: juanId });
    const done = await visit({ date: '2025-06-15', time: '08:00', assignedUserId: pabloId });
    await t.post(`/api/visits/${done.body.id}/complete`, {});
    await visit({ date: '2025-06-13' }); // still scheduled two days later
    await t.db.insert(payments).values([
      { clientId, paidOn: '2025-06-15', amountCents: 40_000_00, method: 'transfer' },
      { clientId, paidOn: '2025-06-15', amountCents: 20_000_00, method: 'cash', collectedByUserId: juanId },
    ]);
  });
  afterAll(() => t.close());

  it('does nothing before the first slot opens', async () => {
    expect(await maybeRunNotificationJobs(deps, EARLY)).toEqual({});
    expect(await t.db.select().from(notifications)).toHaveLength(0);
  });

  it('morning: assignees get their visits, active admins hear about overdue visits (bell and email)', async () => {
    const results = await maybeRunNotificationJobs(deps, MORNING);
    expect(Object.keys(results)).toEqual(['notify_morning']);

    const [juan] = await inbox(juanId, 'visits_today');
    expect(juan).toMatchObject({ title: 'Tus visitas de hoy', link: '/app' });
    expect(juan!.body).toBe('Tenés 2 visitas para hoy, la primera a las 09:30 hs.');
    // Pablo's only visit is already done.
    expect(await inbox(pabloId, 'visits_today')).toHaveLength(0);

    const [overdue] = await inbox(duenaId, 'visits_overdue');
    expect(overdue!.body).toContain('1 visita de días anteriores');
    expect(await inbox(sinMailId, 'visits_overdue')).toHaveLength(1);
    expect(await t.db.select().from(notifications).where(eq(notifications.kind, 'visits_overdue'))).toHaveLength(2);

    // Only the admin with an address is mailed.
    const mails = await ownerMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to: 'duena@example.com', status: 'simulated', clientId: null, refType: 'notification', refId: String(overdue!.id) });
  });

  it('a rerun, even forced past the claim, does not duplicate notifications or emails', async () => {
    expect(await maybeRunNotificationJobs(deps, MORNING)).toEqual({});
    // Drop the claim to simulate a retry after a crash: the dedupe keys still hold.
    await t.db.delete(jobRuns).where(eq(jobRuns.job, 'notify_morning'));
    await maybeRunNotificationJobs(deps, MORNING);
    expect(await inbox(juanId, 'visits_today')).toHaveLength(1);
    expect(await t.db.select().from(notifications).where(eq(notifications.kind, 'visits_overdue'))).toHaveLength(2);
    expect(await ownerMails()).toHaveLength(1);
  });

  it('afternoon: employees with unmarked visits get a reminder', async () => {
    const results = await maybeRunNotificationJobs(deps, AFTERNOON);
    expect(Object.keys(results)).toEqual(['notify_afternoon']);
    const [reminder] = await inbox(juanId, 'visits_reminder');
    expect(reminder!.body).toBe('Todavía tenés 2 visitas de hoy sin marcar.');
    expect(await inbox(pabloId, 'visits_reminder')).toHaveLength(0);
  });

  it('evening: admins get the day summary with visits, collections and cash to hand over', async () => {
    const results = await maybeRunNotificationJobs(deps, EVENING);
    // The afternoon slot is over by then; only the evening one runs.
    expect(Object.keys(results)).toEqual(['notify_evening']);

    const [summary] = await inbox(duenaId, 'day_summary');
    expect(summary!.title).toBe('Resumen del día');
    expect(summary!.body).toContain('1 hecha y 2 pendientes');
    expect(summary!.body).toMatch(/Cobrado hoy: .*60\.000/);
    expect(summary!.body).toMatch(/Efectivo a rendir por los empleados: .*20\.000.* \(1 cobro\)/);
    expect(await inbox(sinMailId, 'day_summary')).toHaveLength(1);
    expect(await inbox(juanId, 'day_summary')).toHaveLength(0);

    const mails = await ownerMails();
    expect(mails.map((m) => m.subject)).toContain('Resumen del día');
    expect(mails).toHaveLength(2);
    expect(await maybeRunNotificationJobs(deps, EVENING)).toEqual({});
  });

  it('skips the evening summary on a day with nothing to report', async () => {
    const quiet = await makeTestApp('2025-07-01');
    const quietDeps: Deps = { db: quiet.db, config: quiet.config, mail: quiet.mail, today: quiet.today };
    await quiet.post('/api/users', { name: 'Dueña', username: 'duena', password: 'secreto3', role: 'admin' });
    const results = await maybeRunNotificationJobs(quietDeps, new Date('2025-07-01T23:30:00Z'));
    expect(results['notify_evening']).toMatchObject({ sent: false });
    expect(await quiet.db.select().from(notifications)).toHaveLength(0);
    await quiet.close();
  });
});

describe('failed client emails', () => {
  it('notify the active admins once per client, kind and day, and never loop on a failing admin mail', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: MailProvider = {
      mode: 'resend',
      from: 'Plagamix <avisos@example.com>',
      async sendEmail() {
        throw new Error('Resend respondió 500');
      },
    };
    const t = await makeTestApp('2025-06-15', failing);
    const duenaId = (await t.post('/api/users', { name: 'Dueña Prueba', username: 'duena', password: 'secreto3', role: 'admin', email: 'duena@example.com' })).body.id;
    const clientId = (await t.post('/api/clients', { name: 'Cliente Uno', email: 'cliente@example.com', phone: '1155551111', address: 'Calle 1' })).body.id;

    const send = (day: string, kind: 'service_notice' | 'debt_reminder' = 'service_notice') =>
      sendLogged(t.db, failing, {
        kind,
        clientId,
        to: 'cliente@example.com',
        email: { subject: 'Aviso', html: '<p>x</p>', text: 'x' },
        today: day,
      });

    const row = await send('2025-06-15');
    expect(row.status).toBe('failed');
    const mine = () => t.db.select().from(notifications).where(eq(notifications.userId, duenaId));
    const [note] = await mine();
    expect(note).toMatchObject({ kind: 'client_email_failed', link: `/clientes/${clientId}` });
    expect(note!.body).toContain('Cliente Uno');
    expect(note!.body).toContain('cliente@example.com');
    expect(note!.body).toContain('Resend respondió 500');

    // The admin copy failed too (same broken provider): logged, not notified, no recursion.
    const mails = await t.db.select().from(emailLog).where(eq(emailLog.kind, 'owner_notification'));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.status).toBe('failed');

    await send('2025-06-15'); // a retry the same day
    expect(await mine()).toHaveLength(1);
    await send('2025-06-15', 'debt_reminder');
    expect(await mine()).toHaveLength(2);
    await send('2025-06-16');
    expect(await mine()).toHaveLength(3);

    // Successful and test sends never notify.
    const ok = createOk();
    await sendLogged(t.db, ok, { kind: 'service_notice', clientId, to: 'cliente@example.com', email: { subject: 'Aviso', html: '<p>x</p>', text: 'x' }, today: '2025-06-17' });
    await sendLogged(t.db, failing, { kind: 'test', clientId: null, to: 'a@example.com', email: { subject: 'Prueba', html: '<p>x</p>', text: 'x' }, today: '2025-06-17' });
    expect(await mine()).toHaveLength(3);

    await t.close();
    error.mockRestore();
  });
});

function createOk(): MailProvider {
  return { mode: 'resend', from: 'Plagamix <avisos@example.com>', sendEmail: async () => ({ providerId: 'id-1' }) };
}
