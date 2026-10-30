import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionToken } from '../auth.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('debt by month', () => {
  let t: TestApp;
  let clientId: number;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    clientId = (await t.post('/api/clients', { name: 'Panadería Mayo' })).body.id;
    const invoice = async (key: string, body: Record<string, unknown>) => {
      const res = await t.post('/api/invoices', { clientId, ...body });
      expect(res.status).toBe(201);
      ids[key] = res.body.id;
    };
    await invoice('march', { amountCents: 100_000_00, issuedOn: '2025-03-01', periodMonth: '2025-03' });
    await invoice('april', { amountCents: 100_000_00, issuedOn: '2025-04-01', periodMonth: '2025-04' });
    // No period: grouped by its issue month (May).
    await invoice('mayVisit', { amountCents: 25_000_00, issuedOn: '2025-05-20', description: 'Visita' });
    await t.post('/api/payments', { clientId, amountCents: 40_000_00, paidOn: '2025-06-01' });
  });
  afterAll(() => t.close());

  it('returns one row per owed month and the total equals the balance', async () => {
    const res = await t.get(`/api/clients/${clientId}/months`);
    expect(res.status).toBe(200);
    expect(res.body.months.map((m: { month: string }) => m.month)).toEqual(['2025-03', '2025-04', '2025-05']);
    expect(res.body.months[0]).toMatchObject({ billedCents: 100_000_00, paidCents: 40_000_00, owedCents: 60_000_00 });
    expect(res.body.months[1]).toMatchObject({ billedCents: 100_000_00, paidCents: 0, owedCents: 100_000_00 });
    expect(res.body.months[2]).toMatchObject({ owedCents: 25_000_00 });
    expect(res.body.months[2].invoices[0]).toMatchObject({ id: ids.mayVisit, balanceCents: 25_000_00 });

    const client = await t.get(`/api/clients/${clientId}`);
    expect(res.body.totalOwedCents).toBe(client.body.summary.balanceCents);
    expect(res.body.totalOwedCents).toBe(185_000_00);
  });

  it('answers 404 for an unknown client', async () => {
    expect((await t.get('/api/clients/9999/months')).status).toBe(404);
  });

  it('shows the oldest owed month and the number of owed months in the debtors list', async () => {
    const res = await t.get('/api/receivables');
    const debtor = res.body.debtors.find((d: { clientId: number }) => d.clientId === clientId);
    expect(debtor).toMatchObject({ oldestOwedMonth: '2025-03', owedMonthCount: 3 });
  });

  it('includes the months in the client portal summary', async () => {
    const cookie = `fumigadora_session=${createSessionToken(t.config, { role: 'client', clientId })}`;
    const res = await t.app.request('/api/portal/summary', { headers: { cookie } });
    const body = (await res.json()) as { months: unknown };
    expect(body.months).toEqual([
      { month: '2025-03', billedCents: 100_000_00, paidCents: 40_000_00, owedCents: 60_000_00 },
      { month: '2025-04', billedCents: 100_000_00, paidCents: 0, owedCents: 100_000_00 },
      { month: '2025-05', billedCents: 25_000_00, paidCents: 0, owedCents: 25_000_00 },
    ]);
  });
});

describe('choosing the months a payment settles', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
  });
  afterAll(() => t.close());

  /** A client owing March, April and May (100.000 each). */
  async function threeMonths() {
    const clientId = (await t.post('/api/clients', { name: `Cliente ${Math.random()}` })).body.id as number;
    const ids: number[] = [];
    for (const month of ['03', '04', '05']) {
      const res = await t.post('/api/invoices', { clientId, amountCents: 100_000_00, issuedOn: `2025-${month}-01`, periodMonth: `2025-${month}` });
      ids.push(res.body.id);
    }
    return { clientId, march: ids[0]!, april: ids[1]!, may: ids[2]! };
  }
  const owed = async (clientId: number) =>
    Object.fromEntries(
      ((await t.get(`/api/clients/${clientId}/months`)).body.months as { month: string; owedCents: number }[]).map((m) => [m.month, m.owedCents]),
    );

  it('pays the selected later month while the earlier one stays owed', async () => {
    const c = await threeMonths();
    const res = await t.post('/api/payments', { clientId: c.clientId, amountCents: 100_000_00, invoiceIds: [c.april] });
    expect(res.status).toBe(201);
    expect(res.body.allocations).toEqual([expect.objectContaining({ invoiceId: c.april, amountCents: 100_000_00 })]);
    expect(await owed(c.clientId)).toEqual({ '2025-03': 100_000_00, '2025-05': 100_000_00 });
  });

  it('pays several selected months in chronological order and sends the remainder FIFO', async () => {
    const c = await threeMonths();
    const res = await t.post('/api/payments', { clientId: c.clientId, amountCents: 250_000_00, invoiceIds: [c.may, c.april] });
    expect(res.body.allocations.map((a: { invoiceId: number; amountCents: number }) => [a.invoiceId, a.amountCents])).toEqual([
      [c.april, 100_000_00],
      [c.may, 100_000_00],
      [c.march, 50_000_00],
    ]);
    expect(res.body.creditCents).toBe(0);
    expect(await owed(c.clientId)).toEqual({ '2025-03': 50_000_00 });
  });

  it('keeps FIFO when nothing is selected', async () => {
    const c = await threeMonths();
    for (const body of [{}, { invoiceIds: [] }]) {
      const res = await t.post('/api/payments', { clientId: c.clientId, amountCents: 10_000_00, ...body });
      expect(res.body.allocations).toEqual([expect.objectContaining({ invoiceId: c.march, amountCents: 10_000_00 })]);
    }
  });

  it('rejects invoices that are not open for the client, and mixing invoiceId with invoiceIds', async () => {
    const c = await threeMonths();
    const other = await threeMonths();
    const foreign = await t.post('/api/payments', { clientId: c.clientId, amountCents: 1_00, invoiceIds: [c.april, other.april] });
    expect(foreign.status).toBe(400);
    const both = await t.post('/api/payments', { clientId: c.clientId, amountCents: 1_00, invoiceId: c.march, invoiceIds: [c.april] });
    expect(both.status).toBe(400);
    expect((await t.get(`/api/payments?clientId=${c.clientId}`)).body).toEqual([]);
  });
});
