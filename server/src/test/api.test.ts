import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_PASSWORD, type TestApp } from './helpers.js';

async function newClient(t: TestApp, name: string, extra: Record<string, unknown> = {}) {
  const res = await t.post('/api/clients', { name, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

async function newInvoice(t: TestApp, clientId: number, amountCents: number, issuedOn: string, extra = {}) {
  const res = await t.post('/api/invoices', { clientId, amountCents, issuedOn, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: number; number: string; dueOn: string };
}

describe('auth', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(() => t.close());

  it('requires a session for API routes but not for health', async () => {
    expect((await t.app.request('/api/health')).status).toBe(200);
    const res = await t.app.request('/api/dashboard');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('rejects a wrong password and a forged cookie', async () => {
    const bad = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(bad.status).toBe(401);
    const forged = await t.app.request('/api/auth/me', { headers: { cookie: 'fumigadora_session=abc.def' } });
    expect(forged.status).toBe(401);
  });

  it('issues an httpOnly SameSite=Lax cookie that unlocks the API', async () => {
    const ok = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect((await t.get('/api/auth/me')).status).toBe(200);
  });
});

describe('invoice -> payment -> status flow', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
  });
  afterAll(() => t.close());

  it('keeps balances, statuses and aging consistent through payments', async () => {
    const clientId = await newClient(t, 'Restaurante La Plaza', { phone: '+54 9 11 5555-0000' });

    const inv1 = await newInvoice(t, clientId, 100_000_00, '2025-05-01');
    const inv2 = await newInvoice(t, clientId, 50_000_00, '2025-06-01');
    expect(inv1.number).toBe('2025-0001');
    expect(inv2.number).toBe('2025-0002');
    expect(inv1.dueOn).toBe('2025-05-11');

    let list = await t.get('/api/clients?filter=overdue');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      balanceCents: 150_000_00,
      overdueCents: 150_000_00,
      daysOverdue: 35,
      agingBucket: '31-60',
    });

    // Pays more than the oldest invoice: FIFO splits across both.
    const pay1 = await t.post('/api/payments', {
      clientId,
      amountCents: 120_000_00,
      paidOn: '2025-06-15',
      method: 'transfer',
    });
    expect(pay1.status).toBe(201);
    expect(pay1.body.allocations.map((a: { amountCents: number }) => a.amountCents)).toEqual([100_000_00, 20_000_00]);
    expect(pay1.body.creditCents).toBe(0);
    expect(pay1.body.client.balanceCents).toBe(30_000_00);

    let invoices = await t.get(`/api/invoices?clientId=${clientId}`);
    const byId = new Map(invoices.body.map((i: { id: number }) => [i.id, i]));
    expect(byId.get(inv1.id)).toMatchObject({ status: 'paid', balanceCents: 0 });
    expect(byId.get(inv2.id)).toMatchObject({ status: 'overdue', isPartial: true, paidCents: 20_000_00, balanceCents: 30_000_00 });

    // Overpayment becomes credit.
    const pay2 = await t.post('/api/payments', { clientId, amountCents: 50_000_00, paidOn: '2025-06-15' });
    expect(pay2.body.allocations).toHaveLength(1);
    expect(pay2.body.creditCents).toBe(20_000_00);
    expect(pay2.body.client.balanceCents).toBe(-20_000_00);
    expect(pay2.body.client.creditCents).toBe(20_000_00);

    // Statement: running balance ends at the client balance.
    const stmt = await t.get(`/api/clients/${clientId}/statement`);
    expect(stmt.status).toBe(200);
    expect(stmt.body.ledger.at(-1).balanceCents).toBe(-20_000_00);
    expect(stmt.body.ledger.map((e: { type: string }) => e.type)).toEqual(['invoice', 'invoice', 'payment', 'payment']);
    expect(stmt.body.summary.counts).toMatchObject({ invoices: 2, payments: 2 });

    // Deleting the overpayment restores the debt.
    const del = await t.del(`/api/payments/${pay2.body.payment.id}`);
    expect(del.body.client.balanceCents).toBe(30_000_00);

    // Voiding the unpaid-part invoice releases what was paid on it as credit.
    const voided = await t.post(`/api/invoices/${inv2.id}/void`);
    expect(voided.body.status).toBe('void');
    const client = await t.get(`/api/clients/${clientId}`);
    expect(client.body.summary.balanceCents).toBe(-20_000_00);
    invoices = await t.get('/api/invoices');
    expect(invoices.body.find((i: { id: number }) => i.id === inv2.id)).toBeUndefined();
  });

  it('pays a specific invoice first and rejects invoices that are not open', async () => {
    const clientId = await newClient(t, 'Consorcio Rivadavia 100');
    const a = await newInvoice(t, clientId, 10_000_00, '2025-04-01');
    const b = await newInvoice(t, clientId, 20_000_00, '2025-05-01');
    const res = await t.post('/api/payments', { clientId, amountCents: 5_000_00, invoiceId: b.id });
    expect(res.body.allocations).toEqual([expect.objectContaining({ invoiceId: b.id, amountCents: 5_000_00 })]);
    const full = await t.post('/api/payments', { clientId, amountCents: 10_000_00, invoiceId: a.id });
    const bad = await t.post('/api/payments', { clientId, amountCents: 1_00, invoiceId: a.id });
    expect(full.status).toBe(201);
    expect(bad.status).toBe(400);
  });

  it('validates input with a Spanish error body', async () => {
    const res = await t.post('/api/payments', { clientId: 1, amountCents: -5, method: 'bitcoin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'validation', message: 'Datos inválidos' });
    expect((await t.get('/api/clients/99999')).status).toBe(404);
  });
});

describe('complete visit transaction', () => {
  let t: TestApp;
  let tankId: number;
  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    const st = await t.post('/api/service-types', {
      name: 'Limpieza de tanque',
      defaultPriceCents: 80_000_00,
      issuesCertificate: true,
      certificateValidityDays: 180,
    });
    tankId = st.body.id;
  });
  afterAll(() => t.close());

  it('creates invoice, certificate and next visit in one go', async () => {
    const clientId = await newClient(t, 'Consorcio Belgrano 500');
    const visit = await t.post('/api/visits', {
      clientId,
      serviceTypeId: tankId,
      date: '2025-06-15',
      time: '09:30',
      frequency: 'monthly',
    });
    expect(visit.status).toBe(201);
    expect(visit.body.time).toBe('09:30');

    const done = await t.post(`/api/visits/${visit.body.id}/complete`, {
      createInvoice: true,
      issueCertificate: true,
      scheduleNext: true,
    });
    expect(done.status).toBe(200);
    expect(done.body.visit).toMatchObject({ status: 'done', priceCents: 80_000_00, date: '2025-06-15' });
    expect(done.body.invoice).toMatchObject({
      visitId: visit.body.id,
      amountCents: 80_000_00,
      issuedOn: '2025-06-15',
      dueOn: '2025-06-25',
      status: 'pending',
      description: 'Limpieza de tanque',
    });
    expect(done.body.certificate).toMatchObject({ number: '1', issuedOn: '2025-06-15', expiresOn: '2025-12-12' });
    expect(done.body.nextVisit).toMatchObject({ date: '2025-07-15', time: '09:30', frequency: 'monthly', status: 'scheduled' });

    // Everything shows up without extra input.
    const client = await t.get(`/api/clients/${clientId}`);
    expect(client.body.summary.balanceCents).toBe(80_000_00);
    expect(client.body.summary.nextVisits[0].date).toBe('2025-07-15');

    // Completing twice is refused.
    expect((await t.post(`/api/visits/${visit.body.id}/complete`, {})).status).toBe(409);
  });

  it('rolls everything back when a step fails', async () => {
    const clientId = await newClient(t, 'Edificio Callao 10');
    const mk = async () =>
      (await t.post('/api/visits', { clientId, serviceTypeId: tankId, date: '2025-06-16', frequency: 'none' })).body.id as number;
    const first = await mk();
    expect(
      (await t.post(`/api/visits/${first}/complete`, { issueCertificate: true, certificateNumber: 'DUP-1' })).status,
    ).toBe(200);

    const second = await mk();
    const failed = await t.post(`/api/visits/${second}/complete`, {
      createInvoice: true,
      issueCertificate: true,
      certificateNumber: 'DUP-1', // unique violation after the invoice insert
    });
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('duplicate');
    expect((await t.get(`/api/visits/${second}`)).body.status).toBe('scheduled');
    const invoices = await t.get(`/api/invoices?clientId=${clientId}`);
    expect(invoices.body).toHaveLength(0);
  });

  it('validates preconditions before touching data', async () => {
    const clientId = await newClient(t, 'Casa Palermo');
    const plain = await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 0 });
    const v = await t.post('/api/visits', { clientId, serviceTypeId: plain.body.id, date: '2025-06-15' });
    expect((await t.post(`/api/visits/${v.body.id}/complete`, { createInvoice: true })).status).toBe(400);
    expect((await t.post(`/api/visits/${v.body.id}/complete`, { issueCertificate: true })).status).toBe(400);
    expect((await t.post(`/api/visits/${v.body.id}/complete`, { scheduleNext: true })).status).toBe(400);
    expect((await t.get(`/api/visits/${v.body.id}`)).body.status).toBe('scheduled');
  });

  it('summarizes the agenda', async () => {
    const clientId = await newClient(t, 'Agenda Test');
    const st = (await t.get('/api/service-types')).body[0].id;
    for (const date of ['2025-06-10', '2025-06-15', '2025-06-16', '2025-06-17', '2025-06-22', '2025-06-23']) {
      await t.post('/api/visits', { clientId, serviceTypeId: st, date });
    }
    const before = (await t.get('/api/agenda/summary')).body;
    // 2025-06-15 is a Sunday: this week (Mon-Sun) ends today.
    expect(before.thisWeek).toBeGreaterThanOrEqual(1);
    t.setToday('2025-06-16'); // Monday
    const s = (await t.get('/api/agenda/summary')).body;
    expect(s.today).toBeGreaterThanOrEqual(1);
    expect(s.tomorrow).toBeGreaterThanOrEqual(1);
    expect(s.thisWeek).toBeGreaterThanOrEqual(s.today + s.tomorrow);
    expect(s.overdueScheduled).toBeGreaterThanOrEqual(2);
    t.setToday('2025-06-15');
  });
});

describe('monthly batch billing', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
  });
  afterAll(() => t.close());

  it('previews, creates once and does not duplicate', async () => {
    const a = await newClient(t, 'Abono A', { monthlyFeeCents: 30_000_00 });
    const b = await newClient(t, 'Abono B', { monthlyFeeCents: 45_000_00 });
    const c = await newClient(t, 'Sin abono');
    const archived = await newClient(t, 'Abono archivado', { monthlyFeeCents: 10_000_00 });
    await t.post(`/api/clients/${archived}/archive`);

    const preview = await t.post('/api/invoices/monthly-batch/preview?month=2025-06');
    expect(preview.status).toBe(200);
    expect(preview.body.clients.map((x: { clientId: number }) => x.clientId)).toEqual([a, b]);
    expect(preview.body.totalCents).toBe(75_000_00);

    const batch = await t.post('/api/invoices/monthly-batch', { month: '2025-06', clientIds: [a, b, c] });
    expect(batch.status).toBe(201);
    expect(batch.body.created).toHaveLength(2);
    expect(batch.body.created[0]).toMatchObject({ periodMonth: '2025-06', amountCents: 30_000_00, description: 'Abono mensual junio 2025' });
    expect(batch.body.created.map((i: { number: string }) => i.number)).toEqual(['2025-0001', '2025-0002']);
    expect(batch.body.skipped).toEqual([{ clientId: c, reason: 'El cliente no tiene abono mensual' }]);

    const again = await t.post('/api/invoices/monthly-batch/preview?month=2025-06');
    expect(again.body.clients).toHaveLength(0);
    const repeat = await t.post('/api/invoices/monthly-batch', { month: '2025-06', clientIds: [a] });
    expect(repeat.body.created).toHaveLength(0);

    // Voiding one makes the client eligible again.
    await t.post(`/api/invoices/${batch.body.created[0].id}/void`);
    const afterVoid = await t.post('/api/invoices/monthly-batch/preview?month=2025-06');
    expect(afterVoid.body.clients.map((x: { clientId: number }) => x.clientId)).toEqual([a]);

    // Other months are independent.
    const july = await t.post('/api/invoices/monthly-batch/preview?month=2025-07');
    expect(july.body.clients).toHaveLength(2);
  });
});

describe('finance, receivables and dashboard', () => {
  let t: TestApp;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    ids.debtor1 = await newClient(t, 'Deudor Viejo');
    ids.debtor2 = await newClient(t, 'Deudor Reciente');
    ids.quiet = await newClient(t, 'Sin visita');
    const st = (await t.post('/api/service-types', {
      name: 'Desinfección',
      defaultPriceCents: 20_000_00,
      issuesCertificate: true,
      certificateValidityDays: 30,
    })).body.id;

    await newInvoice(t, ids.debtor1!, 100_000_00, '2025-02-01'); // due 2025-02-11: 124 days overdue
    await newInvoice(t, ids.debtor2!, 40_000_00, '2025-06-01'); // 4 days overdue
    await t.post('/api/payments', { clientId: ids.debtor2, amountCents: 10_000_00, paidOn: '2025-06-10', method: 'cash' });

    const cats = (await t.get('/api/expense-categories')).body as { id: number }[];
    const cat = cats[0]?.id ?? (await t.post('/api/expense-categories', { name: 'Nafta' })).body.id;
    expect((await t.post('/api/cash-entries', { kind: 'expense', amountCents: 6_000_00, date: '2025-06-05', categoryId: cat })).status).toBe(201);
    expect((await t.post('/api/cash-entries', { kind: 'income', amountCents: 2_000_00, date: '2025-06-06', description: 'Venta de producto' })).status).toBe(201);
    expect((await t.post('/api/cash-entries', { kind: 'expense', amountCents: 1_00, date: '2025-05-05' })).status).toBe(400);
    await t.post('/api/cash-entries', { kind: 'expense', amountCents: 3_000_00, date: '2025-05-20', categoryId: cat });

    // A visit done 10 days ago and nothing scheduled: counts as "without next visit".
    const v = await t.post('/api/visits', { clientId: ids.quiet, serviceTypeId: st, date: '2025-06-05' });
    await t.post(`/api/visits/${v.body.id}/complete`, { completedOn: '2025-06-05', issueCertificate: true });
    // A scheduled visit today.
    await t.post('/api/visits', { clientId: ids.debtor2, serviceTypeId: st, date: '2025-06-15', time: '10:00' });
  });
  afterAll(() => t.close());

  it('summarizes the month with comparison, categories and series', async () => {
    const res = await t.get('/api/finance/summary?month=2025-06');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      month: '2025-06',
      paymentsCents: 10_000_00,
      otherIncomeCents: 2_000_00,
      incomeCents: 12_000_00,
      expensesCents: 6_000_00,
      balanceCents: 6_000_00,
      previous: { month: '2025-05', incomeCents: 0, expensesCents: 3_000_00, balanceCents: -3_000_00 },
    });
    expect(res.body.series).toHaveLength(6);
    expect(res.body.series.at(-1).month).toBe('2025-06');
    expect(res.body.byCategory[0]).toMatchObject({ totalCents: 6_000_00, share: 100 });
  });

  it('lists unified movements sorted by date', async () => {
    const res = await t.get('/api/finance/movements?month=2025-06');
    expect(res.body.movements.map((m: { type: string }) => m.type)).toEqual(['payment', 'income', 'expense']);
    expect(res.body.movements[0]).toMatchObject({ clientName: 'Deudor Reciente', direction: 'in' });
  });

  it('builds receivables sorted by days overdue with aging buckets', async () => {
    const res = await t.get('/api/receivables');
    expect(res.body.debtors.map((d: { name: string }) => d.name)).toEqual(['Deudor Viejo', 'Deudor Reciente']);
    expect(res.body.owedCents).toBe(130_000_00);
    expect(res.body.overdueInvoiceCount).toBe(2);
    const bucket = (b: string) => res.body.buckets.find((x: { bucket: string }) => x.bucket === b);
    expect(bucket('90+')).toMatchObject({ totalCents: 100_000_00, invoiceCount: 1 });
    expect(bucket('1-30')).toMatchObject({ totalCents: 30_000_00, invoiceCount: 1 });
  });

  it('returns the whole dashboard in one call', async () => {
    const res = await t.get('/api/dashboard');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(Object.keys(d).sort()).toEqual(
      [
        'agenda',
        'cashPendingCents',
        'cashPendingCount',
        'clientsWithoutNextVisit',
        'expiringCertificates',
        'month',
        'receivables',
        'services',
        'today',
        'todayVisits',
        'topDebtors',
        'tracking',
      ].sort(),
    );
    expect(d.month).toMatchObject({ incomeCents: 12_000_00, expensesCents: 6_000_00, balanceCents: 6_000_00 });
    expect(d.month.previous.expensesCents).toBe(3_000_00);
    expect(d.receivables).toEqual({ owedCents: 130_000_00, overdueCents: 130_000_00, debtorCount: 2, overdueInvoiceCount: 2 });
    expect(d.topDebtors[0]).toMatchObject({ name: 'Deudor Viejo', daysOverdue: 124, agingBucket: '90+' });
    expect(d.agenda.today).toBe(1);
    expect(d.todayVisits).toHaveLength(1);
    expect(d.todayVisits[0]).toMatchObject({ clientName: 'Deudor Reciente', time: '10:00', serviceTypeName: 'Desinfección' });
    expect(d.services).toEqual({ doneThisMonth: 1, doneLastMonth: 0 });
    // 'Sin visita' had a visit and has nothing upcoming; Deudor Reciente has one today (still upcoming).
    expect(d.clientsWithoutNextVisit).toBe(1);
    // Certificate issued 2025-06-05 + 30 days = 2025-07-05 (20 days left): not within 15 days.
    expect(d.expiringCertificates).toHaveLength(0);

    t.setToday('2025-06-25');
    const later = await t.get('/api/dashboard');
    expect(later.body.expiringCertificates).toHaveLength(1);
    expect(later.body.expiringCertificates[0]).toMatchObject({ clientName: 'Sin visita', daysLeft: 10, number: '1' });
    t.setToday('2025-06-15');
  });

  it('searches clients for the command palette', async () => {
    const res = await t.get('/api/search?q=deudor');
    expect(res.body.clients.map((c: { name: string }) => c.name)).toEqual(['Deudor Reciente', 'Deudor Viejo']);
    expect((await t.get('/api/search?q=')).status).toBe(400);
  });
});
