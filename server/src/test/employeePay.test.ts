import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('employee pay (S3)', () => {
  let t: TestApp;
  let juanId: number;
  let anaId: number;
  let clientId: number;
  let serviceId: number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    anaId = (await t.post('/api/users', { name: 'Ana Gómez', username: 'ana', password: 'secreto2' })).body.id;
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 10_000_00 })).body.id;
  });
  afterAll(() => t.close());

  it('keeps finance totals of existing data unchanged', async () => {
    const cat = (await t.post('/api/expense-categories', { name: 'Herramientas' })).body.id;
    await t.post('/api/cash-entries', { kind: 'expense', amountCents: 5_000_00, categoryId: cat, date: '2025-06-02' });
    await t.post('/api/cash-entries', { kind: 'income', amountCents: 1_000_00, date: '2025-06-03' });
    const summary = (await t.get('/api/finance/summary?month=2025-06')).body;
    expect(summary).toMatchObject({ expensesCents: 5_000_00, otherIncomeCents: 1_000_00, balanceCents: -4_000_00 });
    expect(summary.byCategory).toEqual([{ categoryId: cat, name: 'Herramientas', totalCents: 5_000_00, share: 100 }]);
    const movements = (await t.get('/api/finance/movements?month=2025-06')).body.movements;
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ type: 'income', amountCents: 1_000_00, employeeId: null, employeeName: null });
  });

  it('records a payment to an employee as a "Sueldos" expense that counts in Finanzas', async () => {
    const res = await t.post('/api/employee-pay', { userId: juanId, amountCents: 200_000_00, kind: 'sueldo', date: '2025-06-05', note: 'Junio' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ userId: juanId, userName: 'Juan Pérez', amountCents: 200_000_00, kind: 'sueldo', date: '2025-06-05', note: 'Junio', method: 'cash' });
    await t.post('/api/employee-pay', { userId: juanId, amountCents: 30_000_00, kind: 'adelanto', date: '2025-06-10', method: 'transfer' });
    // The category is created once and reused.
    const cats = (await t.get('/api/expense-categories')).body as { name: string }[];
    expect(cats.filter((c) => c.name === 'Sueldos')).toHaveLength(1);

    const summary = (await t.get('/api/finance/summary?month=2025-06')).body;
    expect(summary.expensesCents).toBe(5_000_00 + 230_000_00);
    expect(summary.byCategory[0]).toMatchObject({ name: 'Sueldos', totalCents: 230_000_00 });
    const movements = (await t.get('/api/finance/movements?month=2025-06')).body.movements;
    expect(movements.find((m: { amountCents: number }) => m.amountCents === 30_000_00)).toMatchObject({
      type: 'expense',
      categoryName: 'Sueldos',
      employeeId: juanId,
      employeeName: 'Juan Pérez',
    });
  });

  it('shows per month what each employee was paid next to the cash they collected and handed over', async () => {
    const visit = async () =>
      (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId, priceCents: 10_000_00 })).body.id;
    const juan = await actor(t, 'juan', 'secreto1');
    const v1 = await visit();
    const v2 = await visit();
    const p1 = (await juan.post(`/api/me/visits/${v1}/done`, { paymentStatus: 'full', method: 'cash' })).body.payment.payment.id;
    await juan.post(`/api/me/visits/${v2}/done`, { paymentStatus: 'partial', method: 'cash', amountCents: 4_000_00 });
    await t.post('/api/cash-handover/confirm', { paymentIds: [p1] });

    const res = await t.get('/api/employee-pay?month=2025-06');
    expect(res.status).toBe(200);
    const juanRow = res.body.employees.find((e: { userId: number }) => e.userId === juanId);
    expect(juanRow).toEqual({
      userId: juanId,
      name: 'Juan Pérez',
      paidCents: 230_000_00,
      byKind: { sueldo: 200_000_00, adelanto: 30_000_00, otro: 0 },
      cashCollectedCents: 14_000_00,
      cashHandedOverCents: 10_000_00,
      cashPendingCents: 4_000_00,
    });
    expect(res.body.employees.find((e: { userId: number }) => e.userId === anaId)).toMatchObject({ paidCents: 0, cashCollectedCents: 0 });
    expect(res.body.totalPaidCents).toBe(230_000_00);
    expect(res.body.payments.map((p: { amountCents: number }) => p.amountCents)).toEqual([30_000_00, 200_000_00]);
    // Another month is empty.
    const may = (await t.get('/api/employee-pay?month=2025-05')).body;
    expect(may.payments).toEqual([]);
    expect(may.totalPaidCents).toBe(0);
  });

  it('keeps the cash handover endpoint as before', async () => {
    const h = (await t.get('/api/cash-handover')).body;
    expect(h).toMatchObject({ pendingCents: 4_000_00, pendingCount: 1 });
    expect(h.employees[0]).toMatchObject({ userId: juanId, pendingCents: 4_000_00, count: 1 });
    expect(h.recent).toHaveLength(1);
  });

  it('validates the input', async () => {
    expect((await t.post('/api/employee-pay', { userId: juanId, amountCents: 0, kind: 'sueldo' })).status).toBe(400);
    expect((await t.post('/api/employee-pay', { userId: juanId, amountCents: 100, kind: 'bono' })).status).toBe(400);
    const unknown = await t.post('/api/employee-pay', { userId: 999_999, amountCents: 100, kind: 'otro' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toBe('El empleado indicado no existe');
  });

  it('deletes only employee payments', async () => {
    const created = (await t.post('/api/employee-pay', { userId: anaId, amountCents: 1_00, kind: 'otro', date: '2025-06-20' })).body;
    expect((await t.del(`/api/employee-pay/${created.id}`)).body).toEqual({ ok: true });
    const plain = (await t.get('/api/cash-entries?month=2025-06&kind=income')).body[0].id;
    expect((await t.del(`/api/employee-pay/${plain}`)).status).toBe(404);
  });

  it('is admin only', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    expect((await juan.get('/api/employee-pay?month=2025-06')).status).toBe(403);
    expect((await juan.post('/api/employee-pay', { userId: juanId, amountCents: 100, kind: 'sueldo' })).status).toBe(403);
  });
});
