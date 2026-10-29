import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notifications } from '../db/schema.js';
import { paymentSummary } from '../services/adminAlerts.js';
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

describe('closing a visit in the field: extras and payment status', () => {
  let t: TestApp;
  let juan: Awaited<ReturnType<typeof actor>>;
  let juanId: number;
  let adminId: number;
  let serviceId: number;
  let baitId: number;
  let stationId: number;

  const newClient = async (name: string) => (await t.post('/api/clients', { name })).body.id as number;
  const newVisit = async (clientId: number, extra: Record<string, unknown> = {}) =>
    (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId, priceCents: 50_000_00, ...extra })).body
      .id as number;
  const adminAlerts = () => t.db.select().from(notifications).where(eq(notifications.userId, adminId)).orderBy(notifications.id);

  beforeAll(async () => {
    // Every alert happens an hour after the previous one, so none of them is grouped with another.
    let tick = 0;
    t = await makeTestApp('2025-06-15', undefined, { now: () => new Date(Date.UTC(2025, 5, 15, 15) + ++tick * 3_600_000) });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    adminId = (await t.post('/api/users', { name: 'Lucas', username: 'lucas', password: 'secreto2', role: 'admin' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    baitId = (await t.post('/api/extras', { name: 'Cebo', priceCents: 4_500_00 })).body.id;
    stationId = (await t.post('/api/extras', { name: 'Estación cebadera', priceCents: 8_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
  });
  afterAll(() => t.close());

  it('closes with 2 extras and a partial transfer: 3 invoice lines, payment on that invoice, nothing to hand over', async () => {
    const c = await newClient('Parcial Transferencia');
    const old = (await t.post('/api/invoices', { clientId: c, amountCents: 10_000_00, issuedOn: '2025-05-01' })).body;
    const v = await newVisit(c);
    const res = await juan.post(`/api/me/visits/${v}/done`, {
      paymentStatus: 'partial',
      method: 'transfer',
      amountCents: 30_000_00,
      extras: [
        { extraId: baitId, quantity: 2 },
        { extraId: stationId, quantity: 1 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.invoice.amountCents).toBe(50_000_00 + 2 * 4_500_00 + 8_000_00);
    expect(res.body.invoice.items.map((i: { description: string }) => i.description)).toEqual(['Desinsectación', 'Cebo', 'Estación cebadera']);
    const { payment } = res.body;
    expect(payment.payment).toMatchObject({ amountCents: 30_000_00, method: 'transfer', collectedByUserId: juanId, visitId: v });
    expect(payment.payment.handedOverAt).not.toBeNull();
    // All of it went to the visit's invoice, none to the older debt.
    expect(payment.allocations.map((a: { invoiceId: number; amountCents: number }) => [a.invoiceId, a.amountCents])).toEqual([[res.body.invoice.id, 30_000_00]]);
    expect((await t.get(`/api/invoices/${old.id}`)).body.paidCents).toBe(0);

    const mine = await juan.get('/api/me/visits');
    expect(mine.body.visits.find((x: { id: number }) => x.id === v)).toMatchObject({ paidCents: 30_000_00, cashCollectedCents: 0 });
    expect(mine.body.cashPending).toEqual({ cents: 0, count: 0 });
    expect((await t.get('/api/cash-handover')).body.pendingCount).toBe(0);
    expect((await t.get('/api/cash-handover')).body.recent).toEqual([]);
  });

  it('pays everything: the whole invoice including extras, cash stays a rendir', async () => {
    const c = await newClient('Paga Todo');
    const v = await newVisit(c);
    const res = await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'full', method: 'cash', extras: [{ extraId: baitId, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.payment.payment).toMatchObject({ amountCents: 54_500_00, method: 'cash', handedOverAt: null });
    expect(res.body.payment.client.balanceCents).toBe(0);
    expect((await t.get(`/api/invoices/${res.body.invoice.id}`)).body.status).toBe('paid');
    expect((await juan.get('/api/me/visits')).body.cashPending.cents).toBeGreaterThanOrEqual(54_500_00);
  });

  it('sends a partial payment above the invoice to the oldest debt', async () => {
    const c = await newClient('Paga de más');
    const old = (await t.post('/api/invoices', { clientId: c, amountCents: 20_000_00, issuedOn: '2025-05-01' })).body;
    const v = await newVisit(c);
    const res = await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'partial', method: 'mercadopago', amountCents: 60_000_00 });
    expect(res.status).toBe(200);
    expect(res.body.payment.allocations.map((a: { invoiceId: number; amountCents: number }) => [a.invoiceId, a.amountCents])).toEqual([
      [res.body.invoice.id, 50_000_00],
      [old.id, 10_000_00],
    ]);
    expect(res.body.payment.payment.method).toBe('mercadopago');
  });

  it('records no payment when the client did not pay', async () => {
    const c = await newClient('No Paga');
    const v = await newVisit(c);
    const res = await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'none' });
    expect(res.status).toBe(200);
    expect(res.body.payment).toBeNull();
    expect(res.body.paymentStatus).toBe('none');
    expect(res.body.invoice.amountCents).toBe(50_000_00);
  });

  it('bills only the extras when the visit has no agreed price', async () => {
    const c = await newClient('Sin precio');
    const v = (await t.post('/api/visits', { clientId: c, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId })).body.id;
    const res = await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'none', extras: [{ extraId: stationId, quantity: 1 }] });
    expect(res.status).toBe(200);
    expect(res.body.invoice.items).toEqual([{ description: 'Estación cebadera', quantity: 1, unitPriceCents: 8_000_00, amountCents: 8_000_00 }]);
  });

  it('validates the payment and rolls everything back', async () => {
    const c = await newClient('Inválido');
    const v = await newVisit(c);
    expect((await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'partial' })).status).toBe(400);
    expect((await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'partial', amountCents: 0 })).status).toBe(400);
    expect((await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'full', method: 'check' })).status).toBe(400);
    expect((await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'none', extras: [{ extraId: 99999, quantity: 1 }] })).status).toBe(404);
    const free = (await t.post('/api/visits', { clientId: c, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId })).body.id;
    expect((await juan.post(`/api/me/visits/${free}/done`, { paymentStatus: 'full' })).status).toBe(400);
    expect((await t.get(`/api/visits/${v}`)).body.status).toBe('scheduled');
    expect((await t.get(`/api/visits/${free}`)).body.status).toBe('scheduled');
    expect((await t.get(`/api/invoices?clientId=${c}`)).body).toEqual([]);
  });

  it('alerts the admins with the payment outcome and a separate extras alert', async () => {
    const before = (await adminAlerts()).length;
    const c = await newClient('Alertas');
    const v = await newVisit(c);
    await juan.post(`/api/me/visits/${v}/done`, {
      paymentStatus: 'partial',
      method: 'transfer',
      amountCents: 20_000_00,
      extras: [
        { extraId: baitId, quantity: 2 },
        { extraId: stationId, quantity: 1 },
      ],
    });
    const created = (await adminAlerts()).slice(before);
    expect(created.map((n) => n.kind).sort()).toEqual(['extras_added', 'visit_done']);
    const done = created.find((n) => n.kind === 'visit_done')!;
    expect(done.body).toMatch(/^Juan Pérez completó la visita de Alertas\. Pagó una parte \(.*20\.000.*, transferencia\)\.$/);
    const extras = created.find((n) => n.kind === 'extras_added')!;
    expect(extras).toMatchObject({ title: 'Extras agregados', groupAmountCents: 17_000_00, link: `/clientes/${c}` });
    expect(extras.body).toMatch(/^Juan Pérez agregó extras en Alertas: 2 × Cebo, 1 × Estación cebadera \(.*17\.000.*\)\.$/);
  });

  it('keeps the cash alert for cash payments only', async () => {
    const before = (await adminAlerts()).filter((n) => n.kind === 'cash_collected').map((n) => n.groupAmountCents);
    const transfer = await newClient('Transfer Alerta');
    await juan.post(`/api/me/visits/${await newVisit(transfer)}/done`, { paymentStatus: 'full', method: 'transfer' });
    expect((await adminAlerts()).filter((n) => n.kind === 'cash_collected').map((n) => n.groupAmountCents)).toEqual(before);
    const cash = await newClient('Efectivo Alerta');
    await juan.post(`/api/me/visits/${await newVisit(cash)}/done`, { paymentStatus: 'full', method: 'cash' });
    expect((await adminAlerts()).filter((n) => n.kind === 'cash_collected').at(-1)!.groupAmountCents).toBeGreaterThanOrEqual(50_000_00);
  });
});

describe('payment wording in alerts', () => {
  it('summarizes the payment outcome', () => {
    expect(paymentSummary({ status: 'none', method: 'cash', amountCents: 0 })).toBe('No pagó');
    expect(paymentSummary({ status: 'full', method: 'cash', amountCents: 50_000_00 })).toMatch(/^Pagó todo \(.*50\.000.*, efectivo\)$/);
    expect(paymentSummary({ status: 'partial', method: 'mercadopago', amountCents: 10_000_00 })).toMatch(/^Pagó una parte \(.*10\.000.*, Mercado Pago\)$/);
  });
});
