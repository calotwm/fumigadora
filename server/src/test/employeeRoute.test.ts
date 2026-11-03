import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { clients } from '../db/schema.js';
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

// Points east of the base along one parallel: a larger km is farther from the base.
const LAT = -34.6037;
const lngAt = (km: number) => -58.3816 + km / 91.5;

describe('ordered day route for the employee', () => {
  let t: TestApp;
  let juan: Awaited<ReturnType<typeof actor>>;
  let juanId: number;
  let serviceId: number;

  async function client(name: string, km: number | null) {
    const id = (await t.post('/api/clients', { name })).body.id as number;
    if (km !== null) await t.db.update(clients).set({ latitude: LAT, longitude: lngAt(km) }).where(eq(clients.id, id));
    return id;
  }
  const visit = async (clientId: number, time: string | null = null) =>
    (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', time, assignedUserId: juanId })).body.id as number;
  const order = async () => ((await juan.get('/api/me/visits')).body.visits as { id: number }[]).map((v) => v.id);

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
  });
  afterAll(() => t.close());

  it('stores the company base in the settings and clears it with null', async () => {
    expect((await t.get('/api/settings')).body).toMatchObject({ companyAddress: null, companyLatitude: null, companyLongitude: null });
    const saved = await t.call('PUT', '/api/settings', { companyAddress: ' Av. de Mayo 760, CABA ', companyLatitude: LAT, companyLongitude: -58.3816 });
    expect(saved.body).toMatchObject({ companyAddress: 'Av. de Mayo 760, CABA', companyLatitude: LAT, companyLongitude: -58.3816 });
    expect((await t.call('PUT', '/api/settings', { companyLatitude: 120 })).status).toBe(400);
    const cleared = await t.call('PUT', '/api/settings', { companyAddress: null, companyLatitude: null, companyLongitude: null });
    expect(cleared.body).toMatchObject({ companyAddress: null, companyLatitude: null, companyLongitude: null });
    // Unrelated settings are untouched.
    expect(cleared.body.noticeDaysBefore).toBe(7);
  });

  it('lists timed visits by time, then nearest-neighbour from the base, unlocated last, done at the bottom', async () => {
    await t.call('PUT', '/api/settings', { companyLatitude: LAT, companyLongitude: -58.3816 });
    const far = await visit(await client('Lejos', 9));
    const nowhere = await visit(await client('Sin ubicación', null));
    const near = await visit(await client('Cerca', 1));
    const mid = await visit(await client('Medio', 4));
    const late = await visit(await client('Tarde', 40), '15:00');
    const early = await visit(await client('Temprano', 30), '08:30');
    const done = await visit(await client('Hecho', 2));
    expect((await juan.post(`/api/me/visits/${done}/done`, {})).status).toBe(200);

    expect(await order()).toEqual([early, late, near, mid, far, nowhere, done]);
    const res = await juan.get('/api/me/visits');
    expect(res.body.base).toEqual({ latitude: LAT, longitude: -58.3816 });
    expect(res.body.visits[2]).toMatchObject({ clientLatitude: LAT, clientLongitude: lngAt(1) });
    expect(res.body.visits[5]).toMatchObject({ clientLatitude: null, clientLongitude: null });
  });

  it('starts at the first located visit when there is no base', async () => {
    await t.call('PUT', '/api/settings', { companyLatitude: null, companyLongitude: null });
    const res = await juan.get('/api/me/visits');
    expect(res.body.base).toBeNull();
    expect(res.body.visits.filter((v: { status: string }) => v.status === 'scheduled').map((v: { clientName: string }) => v.clientName)).toEqual([
      'Temprano',
      'Tarde',
      'Lejos', // lowest id among the located untimed visits
      'Medio', // 5 km from Lejos
      'Cerca', // 3 km from Medio
      'Sin ubicación',
    ]);
  });
});
