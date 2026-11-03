import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notifications } from '../db/schema.js';
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

describe('the client cancels: postpone and cancel by the employee', () => {
  let t: TestApp;
  let juan: Awaited<ReturnType<typeof actor>>;
  let pablo: Awaited<ReturnType<typeof actor>>;
  let juanId: number;
  let pabloId: number;
  let adminId: number;
  let clientId: number;
  let serviceId: number;

  const newVisit = async (extra: Record<string, unknown> = {}) =>
    (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', time: '09:00', assignedUserId: juanId, ...extra })).body
      .id as number;
  const adminAlerts = () => t.db.select().from(notifications).where(eq(notifications.userId, adminId)).orderBy(notifications.id);

  beforeAll(async () => {
    // Every alert happens an hour after the previous one, so none of them is grouped with another.
    let tick = 0;
    t = await makeTestApp('2025-06-15', undefined, { now: () => new Date(Date.UTC(2025, 5, 15, 15) + ++tick * 3_600_000) });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
    adminId = (await t.post('/api/users', { name: 'Lucas', username: 'lucas', password: 'secreto3', role: 'admin' })).body.id;
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
    pablo = await actor(t, 'pablo', 'secreto2');
    expect(pabloId).toBeGreaterThan(0);
  });
  afterAll(() => t.close());

  describe('postpone', () => {
    it('moves the visit to the new date keeping its time, and alerts the admins', async () => {
      const id = await newVisit();
      const res = await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-17' });
      expect(res.status).toBe(200);
      expect(res.body.visit).toMatchObject({ id, date: '2025-06-17', time: '09:00', status: 'scheduled' });
      expect(res.body.previous).toEqual({ date: '2025-06-15', time: '09:00' });
      // It left today's list and is on the new day's.
      expect((await juan.get('/api/me/visits?date=2025-06-15')).body.visits.map((v: { id: number }) => v.id)).not.toContain(id);
      expect((await juan.get('/api/me/visits?date=2025-06-17')).body.visits.map((v: { id: number }) => v.id)).toContain(id);

      const alerts = (await adminAlerts()).filter((n) => n.kind === 'visit_postponed');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ title: 'Visita pospuesta', body: 'Juan Pérez pospuso la visita de Cliente Uno al 17/06 a las 09:00.', link: `/clientes/${clientId}` });
    });

    it('sets or clears the time', async () => {
      const id = await newVisit();
      const set = await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-16', time: '14:30' });
      expect(set.body.visit).toMatchObject({ date: '2025-06-16', time: '14:30' });
      const cleared = await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-18', time: null });
      expect(cleared.body.visit).toMatchObject({ date: '2025-06-18', time: null });
      const sameDayLater = await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-18', time: '16:00' });
      expect(sameDayLater.status).toBe(200);
    });

    it('refuses the past, no change, other employees, finished visits and unknown ids', async () => {
      const id = await newVisit();
      expect((await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-14' })).status).toBe(400);
      expect((await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-15' })).status).toBe(400);
      expect((await juan.post(`/api/me/visits/${id}/postpone`, { date: 'mañana' })).status).toBe(400);
      expect((await pablo.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-16' })).status).toBe(404);
      expect((await juan.post('/api/me/visits/999999/postpone', { date: '2025-06-16' })).status).toBe(404);
      await juan.post(`/api/me/visits/${id}/done`, {});
      expect((await juan.post(`/api/me/visits/${id}/postpone`, { date: '2025-06-16' })).status).toBe(409);
      expect((await t.get(`/api/visits/${id}`)).body.date).toBe('2025-06-15');
    });
  });

  describe('cancel', () => {
    it('cancels with a reason, hides the visit and alerts the admins', async () => {
      const id = await newVisit();
      const res = await juan.post(`/api/me/visits/${id}/cancel`, { reason: '  El cliente no está en la ciudad ' });
      expect(res.status).toBe(200);
      expect(res.body.visit).toMatchObject({ id, status: 'cancelled', cancelReason: 'El cliente no está en la ciudad' });
      expect(res.body.nextVisit).toBeNull();
      expect((await juan.get('/api/me/visits')).body.visits.map((v: { id: number }) => v.id)).not.toContain(id);
      expect((await t.get(`/api/visits/${id}`)).body.status).toBe('cancelled');

      const alerts = (await adminAlerts()).filter((n) => n.kind === 'visit_cancelled');
      expect(alerts.at(-1)).toMatchObject({
        title: 'Visita cancelada',
        body: 'Juan Pérez canceló la visita de Cliente Uno. Motivo: El cliente no está en la ciudad.',
      });
    });

    it('schedules the next occurrence when the visit is recurring', async () => {
      const id = await newVisit({ frequency: 'monthly', priceCents: 42_000_00, time: '10:30' });
      const res = await juan.post(`/api/me/visits/${id}/cancel`, { reason: 'Local cerrado' });
      expect(res.status).toBe(200);
      expect(res.body.nextVisit).toMatchObject({
        date: '2025-07-15',
        time: '10:30',
        frequency: 'monthly',
        priceCents: 42_000_00,
        assignedUserId: juanId,
        status: 'scheduled',
      });
      expect((await juan.get('/api/me/visits?date=2025-07-15')).body.visits.map((v: { id: number }) => v.id)).toContain(res.body.nextVisit.id);
    });

    it('does not schedule the follow-up in the past when a late visit is cancelled', async () => {
      const id = await newVisit({ frequency: 'weekly', date: '2025-06-01' });
      const res = await juan.post(`/api/me/visits/${id}/cancel`, { reason: 'Reprogramado por el cliente' });
      expect(res.body.nextVisit.date).toBe('2025-06-22');
    });

    it('requires a reason and only works on own pending visits', async () => {
      const id = await newVisit();
      expect((await juan.post(`/api/me/visits/${id}/cancel`, {})).status).toBe(400);
      expect((await juan.post(`/api/me/visits/${id}/cancel`, { reason: '   ' })).status).toBe(400);
      expect((await pablo.post(`/api/me/visits/${id}/cancel`, { reason: 'x' })).status).toBe(404);
      expect((await juan.post(`/api/me/visits/${id}/cancel`, { reason: 'Vacaciones' })).status).toBe(200);
      expect((await juan.post(`/api/me/visits/${id}/cancel`, { reason: 'Vacaciones' })).status).toBe(409);
    });

    it('does not alert for what an admin does acting as an employee', async () => {
      const id = await newVisit();
      const before = (await adminAlerts()).length;
      expect((await t.post(`/api/me/visits/${id}/cancel?userId=${juanId}`, { reason: 'Prueba' })).status).toBe(200);
      expect(await adminAlerts()).toHaveLength(before);
    });
  });
});
