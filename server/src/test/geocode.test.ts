import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';

describe('client location', () => {
  let t: TestApp;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: [] };

  beforeAll(async () => {
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    t = await makeTestApp('2025-06-15', undefined, { fetch: fakeFetch });
  });
  afterAll(() => t.close());

  it('stores coordinates on create and update, and validates them', async () => {
    const created = await t.post('/api/clients', { name: 'Con ubicación', latitude: -34.6, longitude: -58.38 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ latitude: -34.6, longitude: -58.38 });

    const moved = await t.patch(`/api/clients/${created.body.id}`, { latitude: -34.7, longitude: -58.4 });
    expect(moved.status).toBe(200);
    expect((await t.get(`/api/clients/${created.body.id}`)).body).toMatchObject({ latitude: -34.7, longitude: -58.4 });

    const cleared = await t.patch(`/api/clients/${created.body.id}`, { latitude: null, longitude: null });
    expect(cleared.body).toMatchObject({ latitude: null, longitude: null });

    expect((await t.post('/api/clients', { name: 'Mal', latitude: 120, longitude: 0 })).status).toBe(400);
  });

  it('finds the coordinates of an address in Argentina', async () => {
    reply = { status: 200, body: [{ lat: '-34.6086', lon: '-58.3797', display_name: 'Avenida de Mayo 760, Buenos Aires' }] };
    const res = await t.get('/api/clients/geocode?q=Av.%20de%20Mayo%20760%2C%20CABA');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ latitude: -34.6086, longitude: -58.3797, label: 'Avenida de Mayo 760, Buenos Aires' });
    const call = calls.at(-1)!;
    const url = new URL(call.url);
    expect(url.hostname).toBe('nominatim.openstreetmap.org');
    expect(url.searchParams.get('q')).toBe('Av. de Mayo 760, CABA');
    expect(url.searchParams.get('countrycodes')).toBe('ar');
    expect(call.headers['User-Agent']).toMatch(/Plagamix/);
  });

  it('answers 404 when the address is not found and 502 when the service fails', async () => {
    reply = { status: 200, body: [] };
    expect((await t.get('/api/clients/geocode?q=xyz')).status).toBe(404);
    reply = { status: 503, body: {} };
    expect((await t.get('/api/clients/geocode?q=xyz')).status).toBe(502);
    expect((await t.get('/api/clients/geocode?q=')).status).toBe(400);
  });
});
