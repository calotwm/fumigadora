import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';

const ALLOWED_KEYS = ['certificate', 'company', 'lastVisitDate', 'name', 'nextVisit'];

describe('public client link', () => {
  let t: TestApp;
  let clientId: number;
  let token: string;
  let serviceId: number;

  const publicGet = (path: string) => t.app.request(path);

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    serviceId = (
      await t.post('/api/service-types', { name: 'Limpieza de tanque', defaultPriceCents: 80_000_00, issuesCertificate: true, certificateValidityDays: 180 })
    ).body.id;
    const client = await t.post('/api/clients', {
      name: 'Consorcio Test 100',
      email: 'admin@consorcio.test',
      phone: '1155550000',
      contactName: 'Pedro Encargado',
      taxId: '30-71234567-8',
      address: 'Calle Falsa 100',
      notes: 'portón verde',
      monthlyFeeCents: 90_000_00,
    });
    clientId = client.body.id;
    token = (await t.get(`/api/clients/${clientId}/public-link`)).body.token;

    // A done visit with an oblea, a pending invoice and a scheduled visit.
    const done = await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-10' });
    await t.post(`/api/visits/${done.body.id}/complete`, { completedOn: '2025-06-10', createInvoice: true, issueCertificate: true, certificateNumber: 'OB-1' });
    await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-07-01', time: '10:30', assignedUserId: null });
  });
  afterAll(() => t.close());

  it('creates an unguessable token for every client and exposes the url', async () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const link = await t.get(`/api/clients/${clientId}/public-link`);
    expect(link.body.url).toMatch(new RegExp(`/c/${token}$`));
    const other = await t.post('/api/clients', { name: 'Otro cliente' });
    expect(other.body.publicToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(other.body.publicToken).not.toBe(token);
  });

  it('uses PUBLIC_BASE_URL when configured', async () => {
    const custom = await makeTestApp('2025-06-15', undefined, { config: { publicBaseUrl: 'https://app.plagamix.example' } });
    const id = (await custom.post('/api/clients', { name: 'X' })).body.id;
    const link = (await custom.get(`/api/clients/${id}/public-link`)).body;
    expect(link.url).toBe(`https://app.plagamix.example/c/${link.token}`);
    await custom.close();
  });

  it('answers without a session, with the next visit and the oblea validity', async () => {
    const res = await publicGet(`/api/public/clients/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      name: 'Consorcio Test 100',
      nextVisit: { date: '2025-07-01', time: '10:30', serviceTypeName: 'Limpieza de tanque' },
      lastVisitDate: '2025-06-10',
      certificate: { number: 'OB-1', valid: true, expiresOn: '2025-12-07' },
      company: { name: 'Plagamix' },
    });
  });

  it('exposes no amounts, tax id, email, phone, address, notes or ids', async () => {
    const body = (await (await publicGet(`/api/public/clients/${token}`)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(ALLOWED_KEYS);
    const raw = JSON.stringify(body);
    for (const secret of ['30-71234567-8', 'admin@consorcio.test', '1155550000', 'Pedro', 'Calle Falsa', 'portón', 'assignee']) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).not.toMatch(/cents/i);
    expect(raw).not.toMatch(/"(id|clientId|taxId|email)":/);
  });

  it('shows the company phone once the owner sets it', async () => {
    await t.call('PUT', '/api/settings', { companyPhone: '11 5555-1234' });
    const body = (await (await publicGet(`/api/public/clients/${token}`)).json()) as { company: unknown };
    expect(body.company).toEqual({ name: 'Plagamix', phone: '11 5555-1234' });
  });

  it('answers 404 for an unknown or malformed token', async () => {
    expect((await publicGet('/api/public/clients/does-not-exist-0123456789abcdef')).status).toBe(404);
    expect((await publicGet('/api/public/clients/x')).status).toBe(404);
    expect((await publicGet('/api/public/clients/%25%25')).status).toBe(404);
  });

  it('does not serve archived clients', async () => {
    const id = (await t.post('/api/clients', { name: 'Archivado' })).body.id;
    const tk = (await t.get(`/api/clients/${id}/public-link`)).body.token;
    expect((await publicGet(`/api/public/clients/${tk}`)).status).toBe(200);
    await t.post(`/api/clients/${id}/archive`);
    expect((await publicGet(`/api/public/clients/${tk}`)).status).toBe(404);
  });

  it('regenerating invalidates the old token and activates the new one', async () => {
    const id = (await t.post('/api/clients', { name: 'Regenerar' })).body.id;
    const first = (await t.get(`/api/clients/${id}/public-link`)).body.token;
    const second = (await t.post(`/api/clients/${id}/public-link/regenerate`)).body;
    expect(second.token).not.toBe(first);
    expect((await publicGet(`/api/public/clients/${first}`)).status).toBe(404);
    expect((await publicGet(`/api/public/clients/${second.token}`)).status).toBe(200);
  });

  it('only the admin manages links', async () => {
    const anon = await t.app.request(`/api/clients/${clientId}/public-link`);
    expect(anon.status).toBe(401);
    const anonRegen = await t.app.request(`/api/clients/${clientId}/public-link/regenerate`, { method: 'POST' });
    expect(anonRegen.status).toBe(401);
  });

  it('lists placards by zone with their links', async () => {
    await t.patch(`/api/clients/${clientId}`, { area: 'Belgrano' });
    const other = (await t.post('/api/clients', { name: 'Otra zona', area: 'Palermo' })).body.id;
    const all = (await t.get('/api/clients/placards')).body;
    expect(all.zones).toEqual(['Belgrano', 'Palermo']);
    const belgrano = (await t.get('/api/clients/placards?area=Belgrano')).body;
    expect(belgrano.items.map((i: { id: number }) => i.id)).toEqual([clientId]);
    expect(belgrano.items[0].url).toMatch(/\/c\//);
    expect(all.items.some((i: { id: number }) => i.id === other)).toBe(true);
  });
});
