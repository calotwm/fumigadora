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

describe('stock (S5)', () => {
  let t: TestApp;
  let juan: Awaited<ReturnType<typeof actor>>;
  let juanId: number;
  let clientId: number;
  let serviceId: number;
  let cipermetrina: number;
  let cebo: number;

  const visit = async () =>
    (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId, priceCents: 1_000_00 })).body.id as number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 1_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
  });
  afterAll(() => t.close());

  it('creates products with a unit and an optional minimum', async () => {
    const res = await t.post('/api/products', { name: 'Cipermetrina', unit: 'litro', minQuantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Cipermetrina', unit: 'litro', minQuantity: 2, active: true, stock: 0, belowMin: true });
    cipermetrina = res.body.id;
    cebo = (await t.post('/api/products', { name: 'Cebo en bloque', unit: 'kg' })).body.id;
    expect((await t.get('/api/products')).body.find((p: { id: number }) => p.id === cebo)).toMatchObject({ minQuantity: null, belowMin: false });
  });

  it('validates products', async () => {
    expect((await t.post('/api/products', { name: '', unit: 'litro' })).status).toBe(400);
    expect((await t.post('/api/products', { name: 'X', unit: 'barril' })).status).toBe(400);
    expect((await t.post('/api/products', { name: 'X', unit: 'kg', minQuantity: -1 })).status).toBe(400);
  });

  it('keeps the current stock from purchases, uses and adjustments, with decimals', async () => {
    expect((await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'purchase', quantity: 5, date: '2025-06-01' })).status).toBe(201);
    await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'use', quantity: 0.75, date: '2025-06-02' });
    await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'adjustment', quantity: -0.25, date: '2025-06-03', note: 'Derrame' });
    const product = (await t.get('/api/products')).body.find((p: { id: number }) => p.id === cipermetrina);
    expect(product).toMatchObject({ stock: 4, belowMin: false });
  });

  it('validates movements', async () => {
    expect((await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'use', quantity: 0 })).status).toBe(400);
    expect((await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'purchase', quantity: -1 })).status).toBe(400);
    expect((await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'adjustment', quantity: 0 })).status).toBe(400);
    expect((await t.post('/api/stock/movements', { productId: cipermetrina, kind: 'use', quantity: 0.0001 })).status).toBe(400);
    const unknown = await t.post('/api/stock/movements', { productId: 999_999, kind: 'use', quantity: 1 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toBe('El producto indicado no existe');
  });

  it('lets the employee register product used when closing a visit, and nothing else', async () => {
    const products = await juan.get('/api/me/products');
    expect(products.status).toBe(200);
    // Only what is needed to pick a product: no stock figures.
    expect(products.body).toEqual([
      { id: cebo, name: 'Cebo en bloque', unit: 'kg' },
      { id: cipermetrina, name: 'Cipermetrina', unit: 'litro' },
    ]);
    const v = await visit();
    const done = await juan.post(`/api/me/visits/${v}/done`, { products: [{ productId: cipermetrina, quantity: 2.5 }] });
    expect(done.status).toBe(200);
    expect(done.body.products).toEqual([{ productId: cipermetrina, name: 'Cipermetrina', unit: 'litro', quantity: 2.5 }]);

    const product = (await t.get('/api/products')).body.find((p: { id: number }) => p.id === cipermetrina);
    expect(product).toMatchObject({ stock: 1.5, belowMin: true });
    const movements = (await t.get('/api/stock/movements?month=2025-06')).body;
    expect(movements[0]).toMatchObject({ kind: 'use', quantity: -2.5, visitId: v, userId: juanId, userName: 'Juan Pérez', clientName: 'Cliente Uno', date: '2025-06-15' });

    expect((await juan.get('/api/products')).status).toBe(403);
    expect((await juan.post('/api/stock/movements', { productId: cipermetrina, kind: 'purchase', quantity: 1 })).status).toBe(403);
  });

  it('closing a visit without products works as before', async () => {
    const v = await visit();
    const done = await juan.post(`/api/me/visits/${v}/done`, { paymentStatus: 'none' });
    expect(done.status).toBe(200);
    expect(done.body.products).toEqual([]);
    expect(done.body.visit.status).toBe('done');
  });

  it('rejects an unknown or archived product at closing, without closing the visit', async () => {
    await t.patch(`/api/products/${cebo}`, { active: false });
    const v = await visit();
    const res = await juan.post(`/api/me/visits/${v}/done`, { products: [{ productId: cebo, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect((await t.get(`/api/visits/${v}`)).body.status).toBe('scheduled');
    expect((await juan.get('/api/me/products')).body.map((p: { id: number }) => p.id)).toEqual([cipermetrina]);
    await t.patch(`/api/products/${cebo}`, { active: true });
  });

  it('reports usage per day and per month', async () => {
    t.setToday('2025-06-16');
    const v = await visit();
    await juan.post(`/api/me/visits/${v}/done`, { products: [{ productId: cebo, quantity: 1 }] });
    await t.post('/api/stock/movements', { productId: cebo, kind: 'use', quantity: 0.5, date: '2025-06-16' });
    const usage = (await t.get('/api/stock/usage?month=2025-06')).body;
    expect(usage.products).toEqual([
      { productId: cebo, name: 'Cebo en bloque', unit: 'kg', used: 1.5 },
      { productId: cipermetrina, name: 'Cipermetrina', unit: 'litro', used: 3.25 },
    ]);
    expect(usage.days).toEqual([
      { date: '2025-06-02', items: [{ productId: cipermetrina, used: 0.75 }] },
      { date: '2025-06-15', items: [{ productId: cipermetrina, used: 2.5 }] },
      { date: '2025-06-16', items: [{ productId: cebo, used: 1.5 }] },
    ]);
    expect((await t.get('/api/stock/usage?month=2025-05')).body).toEqual({ month: '2025-05', products: [], days: [] });
  });

  it('deletes a movement and the stock follows', async () => {
    const created = (await t.post('/api/stock/movements', { productId: cebo, kind: 'purchase', quantity: 10 })).body;
    const before = (await t.get('/api/products')).body.find((p: { id: number }) => p.id === cebo).stock;
    expect((await t.del(`/api/stock/movements/${created.id}`)).body).toEqual({ ok: true });
    expect((await t.get('/api/products')).body.find((p: { id: number }) => p.id === cebo).stock).toBe(before - 10);
    expect((await t.del(`/api/stock/movements/${created.id}`)).status).toBe(404);
  });
});
