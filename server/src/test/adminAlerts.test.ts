import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { notifications, pushSubscriptions } from '../db/schema.js';
import type { PushSender } from '../services/push.js';
import { makeTestApp, type ApiResult, type TestApp } from './helpers.js';

const VAPID = { publicKey: 'BPublicKeyForTests', privateKey: 'private-for-tests', subject: 'mailto:owner@example.com', enabled: true };
const WINDOW = 10 * 60 * 1000;

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

describe('live admin alerts', () => {
  const send = vi.fn<PushSender>(async () => {});
  const clock = { now: new Date('2025-06-15T15:00:00Z') };
  let t: TestApp;
  let juanId: number;
  let pabloId: number;
  let duenaId: number;
  let socioId: number;
  let clientId: number;
  let serviceId: number;
  let juan: Awaited<ReturnType<typeof actor>>;
  let pablo: Awaited<ReturnType<typeof actor>>;
  let duena: Awaited<ReturnType<typeof actor>>;

  const newVisit = async (assignedUserId: number) =>
    (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', time: '09:00', assignedUserId })).body.id as number;
  const alertsOf = (userId: number) => t.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(notifications.id);
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15', undefined, { config: { push: VAPID }, push: send, now: () => clock.now, alertWindowMs: WINDOW });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
    duenaId = (await t.post('/api/users', { name: 'Dueña Prueba', username: 'duena', password: 'secreto3', role: 'admin' })).body.id;
    socioId = (await t.post('/api/users', { name: 'Socio Prueba', username: 'socio', password: 'secreto4', role: 'admin', assignable: true })).body.id;
    const baja = await t.post('/api/users', { name: 'Admin de Baja', username: 'baja', password: 'secreto5', role: 'admin' });
    await t.patch(`/api/users/${baja.body.id}`, { active: false });
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno', phone: '1155551111', address: 'Calle 1' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    juan = await actor(t, 'juan', 'secreto1');
    pablo = await actor(t, 'pablo', 'secreto2');
    duena = await actor(t, 'duena', 'secreto3');
    await duena.post('/api/me/push/subscribe', { endpoint: 'https://push.example.com/send/duena', keys: { p256dh: 'p', auth: 'a' } });
  });
  afterAll(() => t.close());

  it('alerts every active admin when an employee marks a visit done, in the bell and by push', async () => {
    send.mockClear();
    const visit = await newVisit(juanId);
    expect((await juan.post(`/api/me/visits/${visit}/done`, {})).status).toBe(200);

    for (const id of [duenaId, socioId]) {
      const [alert] = await alertsOf(id);
      expect(alert).toMatchObject({ kind: 'visit_done', title: 'Visita completada', body: 'Juan Pérez completó la visita de Cliente Uno.', link: `/clientes/${clientId}`, groupCount: 1, readAt: null });
    }
    // Inactive admins and employees are not alerted.
    expect(await t.db.select().from(notifications)).toHaveLength(2);

    expect(send).toHaveBeenCalledTimes(1); // only the admin with a subscribed device
    const [, payload] = send.mock.calls[0]!;
    expect(JSON.parse(payload)).toMatchObject({ title: 'Visita completada', tag: `alert:visit_done:${juanId}`, link: `/clientes/${clientId}` });
  });

  it('groups a burst from the same employee into one notification and pushes it again with the same tag', async () => {
    send.mockClear();
    advance(3 * 60 * 1000);
    const second = await newVisit(juanId);
    await juan.post(`/api/me/visits/${second}/done`, {});
    advance(3 * 60 * 1000);
    const third = await newVisit(juanId);
    await juan.post(`/api/me/visits/${third}/done`, {});

    const rows = await alertsOf(duenaId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Visitas completadas', body: 'Juan Pérez completó 3 visitas.', link: '/agenda', groupCount: 3 });
    expect(rows[0]!.createdAt.getTime()).toBe(clock.now.getTime());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([, p]) => JSON.parse(p).tag)).toEqual([`alert:visit_done:${juanId}`, `alert:visit_done:${juanId}`]);
    expect((await duena.get('/api/me/notifications')).body.unreadCount).toBe(1);
  });

  it('does not merge alerts of another employee, nor of another kind', async () => {
    const visit = await newVisit(pabloId);
    await pablo.post(`/api/me/visits/${visit}/done`, {});
    const rows = await alertsOf(duenaId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ body: 'Pablo Gómez completó la visita de Cliente Uno.', groupCount: 1 });
  });

  it('alerts about cash collected with the amount, then groups the totals', async () => {
    const first = await newVisit(juanId);
    await juan.post(`/api/me/visits/${first}/done`, { cashCollectedCents: 20_000_00 });
    let rows = (await alertsOf(duenaId)).filter((r) => r.kind === 'cash_collected');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Cobro en efectivo', groupCount: 1, link: `/clientes/${clientId}` });
    expect(rows[0]!.body).toMatch(/^Juan Pérez cobró .*20\.000.* en efectivo de Cliente Uno\.$/);

    advance(60 * 1000);
    const second = await newVisit(juanId);
    await juan.post(`/api/me/visits/${second}/done`, { cashCollectedCents: 15_000_00 });
    rows = (await alertsOf(duenaId)).filter((r) => r.kind === 'cash_collected');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Cobros en efectivo', groupCount: 2, groupAmountCents: 35_000_00, link: '/finanzas' });
    expect(rows[0]!.body).toMatch(/^Juan Pérez registró 2 cobros en efectivo por .*35\.000/);
  });

  it('starts a new notification once the window has passed or the previous one was read', async () => {
    const before = (await alertsOf(duenaId)).filter((r) => r.kind === 'visit_done' && r.body.startsWith('Juan')).length;
    advance(WINDOW + 1000);
    const late = await newVisit(juanId);
    await juan.post(`/api/me/visits/${late}/done`, {});
    let juans = (await alertsOf(duenaId)).filter((r) => r.kind === 'visit_done' && r.body.startsWith('Juan'));
    expect(juans).toHaveLength(before + 1);
    expect(juans.at(-1)).toMatchObject({ body: 'Juan Pérez completó la visita de Cliente Uno.', groupCount: 1 });

    // Reading it also ends the group: the next one is a new notification.
    await duena.post(`/api/me/notifications/${juans.at(-1)!.id}/read`);
    advance(60 * 1000);
    const next = await newVisit(juanId);
    await juan.post(`/api/me/visits/${next}/done`, {});
    juans = (await alertsOf(duenaId)).filter((r) => r.kind === 'visit_done' && r.body.startsWith('Juan'));
    expect(juans).toHaveLength(before + 2);
    // Socio never read theirs, so theirs kept growing instead.
    expect((await alertsOf(socioId)).filter((r) => r.kind === 'visit_done' && r.body.startsWith('Juan')).at(-1)!.groupCount).toBe(2);
  });

  it('does not alert for what the owner or an admin user does themselves', async () => {
    const countBefore = (await t.db.select().from(notifications)).length;
    const visit = await newVisit(socioId);
    // An admin user acting as themself in /api/me.
    const socio = await actor(t, 'socio', 'secreto4');
    expect((await socio.post(`/api/me/visits/${visit}/done`, { cashCollectedCents: 5_000_00 })).status).toBe(200);
    // The owner completing a visit and registering a payment from the admin screens.
    const other = await newVisit(juanId);
    expect((await t.post(`/api/visits/${other}/complete`, {})).status).toBe(200);
    expect((await t.post('/api/payments', { clientId, amountCents: 1_000_00, method: 'cash' })).status).toBe(201);
    // Emergency session acting as an employee through ?userId=.
    const again = await newVisit(juanId);
    expect((await t.post(`/api/me/visits/${again}/done?userId=${juanId}`, {})).status).toBe(200);
    expect(await t.db.select().from(notifications)).toHaveLength(countBefore);
  });

  it('keeps working when the push service is down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValue(new Error('push down'));
    advance(WINDOW * 2);
    const visit = await newVisit(pabloId);
    expect((await pablo.post(`/api/me/visits/${visit}/done`, {})).status).toBe(200);
    expect(await t.db.select().from(pushSubscriptions)).toHaveLength(1);
    error.mockRestore();
  });
});
