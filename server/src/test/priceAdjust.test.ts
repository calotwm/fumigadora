import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';

interface Item {
  scope: string;
  id: number;
  oldCents: number;
  newCents: number;
}

describe('IPC price update', () => {
  let t: TestApp;
  const ids = {} as Record<'service' | 'extra' | 'client' | 'futureVisit' | 'pastVisit' | 'defaultPriceVisit' | 'invoice', number>;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    ids.service = (await t.post('/api/service-types', { name: 'Desinsectación IPC', defaultPriceCents: 45_450_00 })).body.id;
    ids.extra = (await t.post('/api/extras', { name: 'Cebo IPC', priceCents: 12_345_00 })).body.id;
    ids.client = (await t.post('/api/clients', { name: 'Consorcio IPC', monthlyFeeCents: 12_345_00 })).body.id;
    const visit = (date: string, priceCents: number | null) =>
      t.post('/api/visits', { clientId: ids.client, serviceTypeId: ids.service, date, priceCents });
    ids.futureVisit = (await visit('2025-07-01', 20_000_00)).body.id;
    ids.pastVisit = (await visit('2025-06-01', 20_000_00)).body.id;
    ids.defaultPriceVisit = (await visit('2025-07-02', null)).body.id;
    // Existing debt: an invoice partly paid.
    ids.invoice = (await t.post('/api/invoices', { clientId: ids.client, amountCents: 12_345_00, issuedOn: '2025-05-01', periodMonth: '2025-05' })).body.id;
    await t.post('/api/payments', { clientId: ids.client, amountCents: 5_000_00, paidOn: '2025-06-01' });
  });
  afterAll(() => t.close());

  const body = { percent: 10, rounding: '100', scopes: ['serviceTypes', 'extras', 'visits', 'monthlyFees'] };
  const find = (items: Item[], scope: string, id: number) => items.find((i) => i.scope === scope && i.id === id);

  it('previews old -> new prices with round-half-up and the chosen rounding, changing nothing', async () => {
    const res = await t.post('/api/price-adjustments/preview', body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ percent: 10, percentBasisPoints: 1000, rounding: '100' });
    const items = res.body.items as Item[];
    expect(find(items, 'serviceTypes', ids.service)).toMatchObject({ oldCents: 45_450_00, newCents: 50_000_00 });
    expect(find(items, 'extras', ids.extra)).toMatchObject({ oldCents: 12_345_00, newCents: 13_600_00 });
    expect(find(items, 'monthlyFees', ids.client)).toMatchObject({ oldCents: 12_345_00, newCents: 13_600_00 });
    expect(find(items, 'visits', ids.futureVisit)).toMatchObject({ oldCents: 20_000_00, newCents: 22_000_00 });
    // Past visits and visits without their own price are not part of the update.
    expect(find(items, 'visits', ids.pastVisit)).toBeUndefined();
    expect(find(items, 'visits', ids.defaultPriceVisit)).toBeUndefined();
    expect(res.body.itemCount).toBe(items.length);

    const service = (await t.get('/api/service-types')).body.find((s: { id: number }) => s.id === ids.service);
    expect(service.defaultPriceCents).toBe(45_450_00);
    expect((await t.get('/api/price-adjustments')).body).toEqual([]);
  });

  it('only previews the chosen scopes', async () => {
    const res = await t.post('/api/price-adjustments/preview', { percent: 3.2, scopes: ['monthlyFees'] });
    expect(res.body.items.every((i: Item) => i.scope === 'monthlyFees')).toBe(true);
    expect(find(res.body.items, 'monthlyFees', ids.client)).toMatchObject({ newCents: 12_740_04 });
  });

  it('applies exactly the preview, leaves invoices and balances untouched and records the history', async () => {
    const invoicesBefore = (await t.get('/api/invoices')).body;
    const clientBefore = (await t.get(`/api/clients/${ids.client}`)).body.summary;
    const monthsBefore = (await t.get(`/api/clients/${ids.client}/months`)).body;
    const preview = await t.post('/api/price-adjustments/preview', body);

    const applied = await t.post('/api/price-adjustments', body);
    expect(applied.status).toBe(201);
    expect(applied.body.items).toEqual(preview.body.items);
    expect(applied.body.adjustment).toMatchObject({ percent: 10, rounding: '100', scopes: body.scopes, itemCount: preview.body.itemCount });

    const service = (await t.get('/api/service-types')).body.find((s: { id: number }) => s.id === ids.service);
    expect(service.defaultPriceCents).toBe(50_000_00);
    const client = await t.get(`/api/clients/${ids.client}`);
    expect(client.body.monthlyFeeCents).toBe(13_600_00);
    const visits = (await t.get(`/api/clients/${ids.client}/statement`)).body.visits as { id: number; priceCents: number | null }[];
    expect(visits.find((v) => v.id === ids.futureVisit)!.priceCents).toBe(22_000_00);
    expect(visits.find((v) => v.id === ids.pastVisit)!.priceCents).toBe(20_000_00);
    expect(visits.find((v) => v.id === ids.defaultPriceVisit)!.priceCents).toBeNull();

    expect((await t.get('/api/invoices')).body).toEqual(invoicesBefore);
    expect(client.body.summary).toEqual(clientBefore);
    expect((await t.get(`/api/clients/${ids.client}/months`)).body).toEqual(monthsBefore);

    const history = await t.get('/api/price-adjustments');
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ percent: 10, rounding: '100', userName: 'Dueño', itemCount: preview.body.itemCount });
  });

  it('validates the input', async () => {
    expect((await t.post('/api/price-adjustments/preview', { percent: 0, scopes: ['extras'] })).status).toBe(400);
    expect((await t.post('/api/price-adjustments/preview', { percent: 3.255, scopes: ['extras'] })).status).toBe(400);
    expect((await t.post('/api/price-adjustments/preview', { percent: 5, scopes: [] })).status).toBe(400);
    expect((await t.post('/api/price-adjustments/preview', { percent: 5, rounding: '50', scopes: ['extras'] })).status).toBe(400);
  });

  it('is owner only', async () => {
    await t.post('/api/users', { name: 'Juan IPC', username: 'juanipc', password: 'juan-ipc-1234', role: 'employee' });
    const login = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'juanipc', password: 'juan-ipc-1234' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    for (const [method, path] of [
      ['GET', '/api/price-adjustments'],
      ['POST', '/api/price-adjustments/preview'],
      ['POST', '/api/price-adjustments'],
    ] as const) {
      const res = await t.app.request(path, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      expect(res.status).toBe(403);
    }
    expect((await t.get('/api/price-adjustments')).body).toHaveLength(1);
  });
});
