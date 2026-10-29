import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { serviceTypes } from '../db/schema.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('extras and invoice lines', () => {
  let t: TestApp;
  let clientId: number;
  let plainId: number;
  let tankId: number;
  let baitId: number;
  let stationId: number;

  const newVisit = async (serviceTypeId: number, extra: Record<string, unknown> = {}) =>
    (await t.post('/api/visits', { clientId, serviceTypeId, date: '2025-06-15', ...extra })).body.id as number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    clientId = (await t.post('/api/clients', { name: 'Cliente Extras' })).body.id;
    plainId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    tankId = (
      await t.post('/api/service-types', { name: 'Tanque', defaultPriceCents: 70_000_00, issuesCertificate: true, certificateValidityDays: 180 })
    ).body.id;
    baitId = (await t.post('/api/extras', { name: 'Cebo', priceCents: 4_500_00 })).body.id;
    stationId = (await t.post('/api/extras', { name: 'Estación cebadera', priceCents: 8_000_00 })).body.id;
  });
  afterAll(() => t.close());

  it('manages the catalog and offers only active extras to employees', async () => {
    const off = await t.post('/api/extras', { name: 'Descontinuado', priceCents: 1_000_00, active: false });
    expect(off.status).toBe(201);
    expect((await t.get('/api/extras')).body.map((e: { name: string }) => e.name)).toEqual(['Cebo', 'Descontinuado', 'Estación cebadera']);
    expect((await t.patch(`/api/extras/${baitId}`, { priceCents: 5_000_00 })).body.priceCents).toBe(5_000_00);
    await t.patch(`/api/extras/${baitId}`, { priceCents: 4_500_00 });
    expect((await t.post('/api/extras', { name: '', priceCents: 100 })).status).toBe(400);
    expect((await t.post('/api/extras', { name: 'Gratis', priceCents: 0 })).status).toBe(400);

    await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' });
    const login = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'juan', password: 'secreto1' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const mine = await t.app.request('/api/me/extras', { headers: { cookie } });
    expect(((await mine.json()) as { name: string }[]).map((e) => e.name)).toEqual(['Cebo', 'Estación cebadera']);
    expect((await t.app.request('/api/extras', { headers: { cookie } })).status).toBe(403);
    expect((await t.del(`/api/extras/${off.body.id}`)).status).toBe(200);
  });

  it('bills the base service and each extra as invoice lines that add up to the total', async () => {
    const id = await newVisit(plainId, { priceCents: 40_000_00 });
    const res = await t.post(`/api/visits/${id}/complete`, {
      createInvoice: true,
      extras: [
        { extraId: baitId, quantity: 2 },
        { extraId: stationId, quantity: 1 },
        { extraId: baitId, quantity: 1 }, // merged with the first bait line
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.invoice.amountCents).toBe(40_000_00 + 3 * 4_500_00 + 8_000_00);
    expect(res.body.invoice.items).toEqual([
      { description: 'Desinsectación', quantity: 1, unitPriceCents: 40_000_00, amountCents: 40_000_00 },
      { description: 'Cebo', quantity: 3, unitPriceCents: 4_500_00, amountCents: 13_500_00 },
      { description: 'Estación cebadera', quantity: 1, unitPriceCents: 8_000_00, amountCents: 8_000_00 },
    ]);
    expect(res.body.extras).toHaveLength(2);

    // The stored lines come back from every invoice view.
    const fetched = await t.get(`/api/invoices/${res.body.invoice.id}`);
    expect(fetched.body.items).toHaveLength(3);
    const listed = (await t.get(`/api/invoices?clientId=${clientId}`)).body.find((i: { id: number }) => i.id === res.body.invoice.id);
    expect(listed.items).toHaveLength(3);
    const statement = await t.get(`/api/clients/${clientId}/statement`);
    expect(statement.body.invoices.find((i: { id: number }) => i.id === res.body.invoice.id).items).toHaveLength(3);
    // ARCA only sees the total.
    expect(fetched.body.amountCents).toBe(61_500_00);
  });

  it('renders invoices without stored lines as one line from description and amount', async () => {
    const manual = await t.post('/api/invoices', { clientId, amountCents: 12_000_00, description: 'Trabajo especial' });
    expect(manual.body.items).toEqual([{ description: 'Trabajo especial', quantity: 1, unitPriceCents: 12_000_00, amountCents: 12_000_00 }]);
    const bare = await t.post('/api/invoices', { clientId, amountCents: 3_000_00 });
    expect(bare.body.items[0]).toMatchObject({ description: 'Servicio', amountCents: 3_000_00 });
  });

  it('only bills extras on an invoice and refuses unknown or inactive ones', async () => {
    const id = await newVisit(plainId);
    expect((await t.post(`/api/visits/${id}/complete`, { extras: [{ extraId: baitId, quantity: 1 }] })).status).toBe(400);
    expect((await t.post(`/api/visits/${id}/complete`, { createInvoice: true, extras: [{ extraId: 99999, quantity: 1 }] })).status).toBe(404);
    expect((await t.post(`/api/visits/${id}/complete`, { createInvoice: true, extras: [{ extraId: baitId, quantity: 0 }] })).status).toBe(400);
    const hidden = (await t.post('/api/extras', { name: 'Oculto', priceCents: 900_00, active: false })).body.id;
    expect((await t.post(`/api/visits/${id}/complete`, { createInvoice: true, extras: [{ extraId: hidden, quantity: 1 }] })).status).toBe(400);
    expect((await t.get(`/api/visits/${id}`)).body.status).toBe('scheduled');
  });

  it('bills only the extras when the visit has no price', async () => {
    const free = (await t.post('/api/service-types', { name: 'Revisión', defaultPriceCents: 0 })).body.id;
    const id = await newVisit(free);
    const res = await t.post(`/api/visits/${id}/complete`, { createInvoice: true, extras: [{ extraId: stationId, quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(res.body.invoice.items).toEqual([{ description: 'Estación cebadera', quantity: 2, unitPriceCents: 8_000_00, amountCents: 16_000_00 }]);
  });

  it('keeps used extras: deleting is refused, deactivating works', async () => {
    expect((await t.del(`/api/extras/${baitId}`)).status).toBe(409);
    expect((await t.patch(`/api/extras/${stationId}`, { active: false })).body.active).toBe(false);
    await t.patch(`/api/extras/${stationId}`, { active: true });
  });

  it('always issues the oblea when the service type issues certificates, with the included-services copy', async () => {
    const id = await newVisit(tankId);
    const res = await t.post(`/api/visits/${id}/complete`, { createInvoice: true });
    expect(res.status).toBe(200);
    expect(res.body.certificate).toMatchObject({ expiresOn: '2025-12-12' });
    expect(res.body.invoice.description).toBe('Tanque');
    expect(res.body.invoice.items[0].description).toBe('Tanque (incluye desinfección y oblea)');

    // The owner can still opt out explicitly.
    const skip = await newVisit(tankId);
    expect((await t.post(`/api/visits/${skip}/complete`, { issueCertificate: false })).body.certificate).toBeNull();
    // A type without certificates never issues one, even when asked.
    const plain = await newVisit(plainId);
    expect((await t.post(`/api/visits/${plain}/complete`, { issueCertificate: true })).status).toBe(400);
    expect((await t.post(`/api/visits/${plain}/complete`, {})).body.certificate).toBeNull();
  });

  it('defaults the oblea validity to 30 days when the service type has none', async () => {
    await t.db.update(serviceTypes).set({ certificateValidityDays: null }).where(eq(serviceTypes.id, tankId));
    const id = await newVisit(tankId);
    const res = await t.post(`/api/visits/${id}/complete`, {});
    expect(res.body.certificate).toMatchObject({ issuedOn: '2025-06-15', expiresOn: '2025-07-15' });
  });
});
