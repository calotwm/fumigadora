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
