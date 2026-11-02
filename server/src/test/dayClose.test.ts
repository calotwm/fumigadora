import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { emailLog, notifications, payments } from '../db/schema.js';
import type { Deps } from '../http.js';
import { maybeRunNotificationJobs } from '../services/jobs.js';
import { makeTestApp, type ApiResult, type TestApp } from './helpers.js';

async function actor(t: TestApp, username: string, password: string) {
  const res = await t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const call = async (method: string, path: string, body?: unknown): Promise<ApiResult> => {
    const r = await t.app.request(path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b) };
}

// 20:30 in Buenos Aires on 2025-06-15.
const EVENING = new Date('2025-06-15T23:30:00Z');

describe('end-of-day summary ("Cierre del día")', () => {
  let t: TestApp;
  let juan: Awaited<ReturnType<typeof actor>>;
  let pablo: Awaited<ReturnType<typeof actor>>;
  let juanId: number;
  let pabloId: number;
  let adminId: number;
  let serviceId: number;
  let todayInvoiceNumber: string;
  let dueYesterdayId: number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
    adminId = (await t.post('/api/users', { name: 'Lucas', username: 'lucas', password: 'secreto3', role: 'admin', email: 'lucas@example.com' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
    pablo = await actor(t, 'pablo', 'secreto2');

    const client = async (name: string) => (await t.post('/api/clients', { name })).body.id as number;
    const visit = async (clientId: number, extra: Record<string, unknown>) =>
      (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', priceCents: 50_000_00, ...extra })).body.id as number;
    const a = await client('Cliente A');
    const b = await client('Cliente B');
    const c = await client('Cliente C');

    // Juan: one done (cash, a rendir), one pending, one postponed, one cancelled. Pablo: one done by transfer.
    const done1 = await visit(a, { assignedUserId: juanId });
    expect((await juan.post(`/api/me/visits/${done1}/done`, { paymentStatus: 'full', method: 'cash' })).status).toBe(200);
    await visit(a, { assignedUserId: juanId, time: '15:00' });
    const moved = await visit(b, { assignedUserId: juanId });
    expect((await juan.post(`/api/me/visits/${moved}/postpone`, { date: '2025-06-16' })).status).toBe(200);
    const dropped = await visit(b, { assignedUserId: juanId });
    expect((await juan.post(`/api/me/visits/${dropped}/cancel`, { reason: 'Cerrado' })).status).toBe(200);
    const done2 = await visit(b, { assignedUserId: pabloId });
    expect((await pablo.post(`/api/me/visits/${done2}/done`, { paymentStatus: 'full', method: 'transfer' })).status).toBe(200);
    // Unassigned and still pending; another day's visit does not count.
    await visit(c, {});
    await visit(c, { date: '2025-06-14', assignedUserId: juanId });

    // Office payment today, and older cash still a rendir (counts only in the overall pending).
    expect((await t.post('/api/payments', { clientId: c, amountCents: 10_000_00, method: 'transfer', paidOn: '2025-06-15' })).status).toBe(201);
    await t.db.insert(payments).values({ clientId: c, paidOn: '2025-06-14', amountCents: 5_000_00, method: 'cash', collectedByUserId: juanId });

    // Invoices: one issued today by hand; one became overdue today (due yesterday); one was already overdue.
    todayInvoiceNumber = (await t.post('/api/invoices', { clientId: c, amountCents: 7_000_00, issuedOn: '2025-06-15', dueOn: '2025-06-30' })).body.number;
    dueYesterdayId = (await t.post('/api/invoices', { clientId: c, amountCents: 12_000_00, issuedOn: '2025-05-15', dueOn: '2025-06-14' })).body.id;
    await t.post('/api/invoices', { clientId: c, amountCents: 3_000_00, issuedOn: '2025-05-01', dueOn: '2025-06-10' });

    // Expenses: today's counts, yesterday's and today's income do not.
    const cat = (await t.post('/api/expense-categories', { name: 'Combustible' })).body.id;
    await t.post('/api/cash-entries', { kind: 'expense', amountCents: 6_000_00, date: '2025-06-15', categoryId: cat, description: 'Nafta' });
    await t.post('/api/cash-entries', { kind: 'expense', amountCents: 1_000_00, date: '2025-06-14', categoryId: cat });
    await t.post('/api/cash-entries', { kind: 'income', amountCents: 2_000_00, date: '2025-06-15', description: 'Venta' });
  });
  afterAll(() => t.close());

  it('summarizes visits per employee, collections, invoices, new overdue debt and expenses of today', async () => {
    const res = await t.get('/api/day-close');
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2025-06-15');

    expect(res.body.visits.totals).toEqual({ done: 2, pending: 2, postponed: 1, cancelled: 1 });
    expect(res.body.visits.byEmployee).toEqual([
      { userId: juanId, name: 'Juan Pérez', done: 1, pending: 1, postponed: 1, cancelled: 1 },
      { userId: pabloId, name: 'Pablo Gómez', done: 1, pending: 0, postponed: 0, cancelled: 0 },
      { userId: null, name: 'Sin asignar', done: 0, pending: 1, postponed: 0, cancelled: 0 },
    ]);

    const col = res.body.collections;
    expect(col.totalCents).toBe(110_000_00);
    expect(col.count).toBe(3);
    expect(col.byMethod).toEqual([
      { method: 'transfer', cents: 60_000_00, count: 2 },
      { method: 'cash', cents: 50_000_00, count: 1 },
    ]);
    expect(col.byEmployee).toEqual([
      { userId: juanId, name: 'Juan Pérez', cents: 50_000_00, count: 1, cashCents: 50_000_00, toHandOverCents: 50_000_00 },
      { userId: pabloId, name: 'Pablo Gómez', cents: 50_000_00, count: 1, cashCents: 0, toHandOverCents: 0 },
      { userId: null, name: 'Oficina', cents: 10_000_00, count: 1, cashCents: 0, toHandOverCents: 0 },
    ]);
    // Cash a rendir: what today's collections left pending, and everything still pending (yesterday's too).
    expect(col.cashToHandOver).toEqual({ dayCents: 50_000_00, dayCount: 1, totalCents: 55_000_00, totalCount: 2 });

    // Two invoices from the completed visits plus the manual one.
    expect(res.body.invoices.count).toBe(3);
    expect(res.body.invoices.totalCents).toBe(107_000_00);
    expect(res.body.invoices.items.map((i: { number: string }) => i.number)).toContain(todayInvoiceNumber);
    expect(res.body.invoices.items[0]).toMatchObject({ clientName: expect.any(String), amountCents: expect.any(Number) });

    expect(res.body.newOverdue).toEqual({
      count: 1,
      totalCents: 12_000_00,
      items: [expect.objectContaining({ invoiceId: dueYesterdayId, clientName: 'Cliente C', balanceCents: 12_000_00, dueOn: '2025-06-14' })],
    });

    expect(res.body.expenses.count).toBe(1);
    expect(res.body.expenses.totalCents).toBe(6_000_00);
    expect(res.body.expenses.items).toEqual([
      expect.objectContaining({ amountCents: 6_000_00, categoryName: 'Combustible', description: 'Nafta', method: 'cash' }),
    ]);
  });

  it('accepts any date and rejects an invalid one', async () => {
    const past = await t.get('/api/day-close?date=2025-06-14');
    expect(past.status).toBe(200);
    expect(past.body.date).toBe('2025-06-14');
    expect(past.body.visits.totals).toEqual({ done: 0, pending: 1, postponed: 0, cancelled: 0 });
    expect(past.body.collections.byEmployee).toEqual([
      { userId: juanId, name: 'Juan Pérez', cents: 5_000_00, count: 1, cashCents: 5_000_00, toHandOverCents: 5_000_00 },
    ]);
    expect(past.body.collections.cashToHandOver).toMatchObject({ dayCents: 5_000_00, dayCount: 1 });
    expect(past.body.expenses.totalCents).toBe(1_000_00);
    expect(past.body.invoices).toEqual({ count: 0, totalCents: 0, items: [] });

    expect((await t.get('/api/day-close?date=2025-13-40')).status).toBe(400);
  });

  it('is admin-only', async () => {
    expect((await juan.get('/api/day-close')).status).toBe(403);
  });

  it('the 20:00 notice carries the headline numbers and links to the day close', async () => {
    const deps: Deps = { db: t.db, config: t.config, mail: t.mail, today: t.today };
    const results = await maybeRunNotificationJobs(deps, EVENING);
    expect(results['notify_evening']).toMatchObject({ sent: true });
    const [notice] = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, adminId), eq(notifications.kind, 'day_summary')));
    expect(notice!.link).toBe('/cierre?fecha=2025-06-15');
    expect(notice!.body).toContain('2 hechas y 2 pendientes');
    expect(notice!.body).toContain('Pospuestas: 1. Canceladas: 1.');
    expect(notice!.body).toMatch(/Cobrado hoy: .*110\.000/);
    expect(notice!.body).toMatch(/Facturado hoy: .*107\.000.* \(3 facturas\)/);
    expect(notice!.body).toMatch(/Deuda que venció hoy: .*12\.000/);
    expect(notice!.body).toMatch(/Gastos de hoy: .*6\.000/);
    // Owner email through the existing path, once.
    const summaryMails = () =>
      t.db.select().from(emailLog).where(and(eq(emailLog.kind, 'owner_notification'), eq(emailLog.subject, 'Resumen del día')));
    expect(await summaryMails()).toEqual([expect.objectContaining({ to: 'lucas@example.com', refId: String(notice!.id) })]);
    expect(await maybeRunNotificationJobs(deps, EVENING)).toEqual({});
    expect(await summaryMails()).toHaveLength(1);
  });
});
