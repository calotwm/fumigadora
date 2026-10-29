import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { pushSubscriptions } from '../db/schema.js';
import { createNotification } from '../services/notifications.js';
import type { PushSender } from '../services/push.js';
import { makeTestApp, type ApiResult, type TestApp } from './helpers.js';

const VAPID = { publicKey: 'BPublicKeyForTests', privateKey: 'private-for-tests', subject: 'mailto:owner@example.com', enabled: true };
const subscription = (n: number) => ({ endpoint: `https://push.example.com/send/device-${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });

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

describe('web push', () => {
  const send = vi.fn<PushSender>(async () => {});
  let t: TestApp;
  let juanId: number;
  let pabloId: number;

  const notify = (userId: number, refId: string) =>
    createNotification(t.db, { userId, kind: 'visits_today', title: 'Tus visitas de hoy', body: 'Tenés 2 visitas', link: '/app', refType: 'test', refId, day: '2025-06-15' });

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15', undefined, { config: { push: VAPID }, push: send });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
  });
  afterAll(() => t.close());

  it('reports it is enabled with the public key, and requires a session', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    expect((await juan.get('/api/me/push')).body).toEqual({ enabled: true, publicKey: VAPID.publicKey });
    expect((await t.app.request('/api/me/push')).status).toBe(401);
    const anonymous = await t.app.request('/api/me/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscription(1)),
    });
    expect(anonymous.status).toBe(401);
  });

  it('subscribes a device (upsert by endpoint) and unsubscribes it', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    expect((await juan.post('/api/me/push/subscribe', subscription(1))).status).toBe(201);
    expect((await juan.post('/api/me/push/subscribe', { ...subscription(1), keys: { p256dh: 'new', auth: 'new-auth' } })).status).toBe(201);
    let rows = await t.db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: juanId, p256dh: 'new', auth: 'new-auth' });

    // The same phone signed in as someone else moves to that account.
    const pablo = await actor(t, 'pablo', 'secreto2');
    await pablo.post('/api/me/push/subscribe', subscription(1));
    rows = await t.db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(pabloId);

    // Others cannot remove it; the owner of the device can.
    await juan.post('/api/me/push/unsubscribe', { endpoint: subscription(1).endpoint });
    expect(await t.db.select().from(pushSubscriptions)).toHaveLength(1);
    expect((await pablo.post('/api/me/push/unsubscribe', { endpoint: subscription(1).endpoint })).status).toBe(200);
    expect(await t.db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('rejects malformed subscriptions and the userless emergency session', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    expect((await juan.post('/api/me/push/subscribe', { endpoint: 'not-a-url', keys: {} })).status).toBe(400);
    expect((await t.post('/api/me/push/subscribe', subscription(9))).status).toBe(400);
  });

  it('pushes every new notification to the devices of its user only', async () => {
    send.mockClear();
    const juan = await actor(t, 'juan', 'secreto1');
    const pablo = await actor(t, 'pablo', 'secreto2');
    await juan.post('/api/me/push/subscribe', subscription(1));
    await juan.post('/api/me/push/subscribe', subscription(2));
    await pablo.post('/api/me/push/subscribe', subscription(3));

    const created = await notify(juanId, 'push-1');
    expect(send).toHaveBeenCalledTimes(2);
    const [target, payload] = send.mock.calls[0]!;
    expect(target.endpoint).toBe(subscription(1).endpoint);
    expect(target.keys).toEqual(subscription(1).keys);
    expect(JSON.parse(payload)).toEqual({ title: 'Tus visitas de hoy', body: 'Tenés 2 visitas', link: '/app', tag: `notification-${created!.id}` });

    // A repeated (deduped) notification does not push again.
    await notify(juanId, 'push-1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('removes subscriptions that answer 410 or 404 and keeps the others', async () => {
    send.mockImplementation(async (target) => {
      if (target.endpoint === subscription(1).endpoint) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (target.endpoint === subscription(2).endpoint) throw Object.assign(new Error('not found'), { statusCode: 404 });
    });
    const juan = await actor(t, 'juan', 'secreto1');
    await juan.post('/api/me/push/subscribe', subscription(4));
    await notify(juanId, 'push-2');
    const left = await t.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, juanId));
    expect(left.map((s) => s.endpoint)).toEqual([subscription(4).endpoint]);
    expect(left[0]!.lastUsedAt).not.toBeNull();
  });

  it('never fails the caller when the push service errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockRejectedValue(new Error('push service down'));
    expect(await notify(juanId, 'push-3')).not.toBeNull();
    expect(await t.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, juanId))).toHaveLength(1);
    error.mockRestore();
  });
});

describe('web push without VAPID', () => {
  it('is disabled: nothing is sent and subscribing answers 409', async () => {
    const send = vi.fn<PushSender>(async () => {});
    const t = await makeTestApp('2025-06-15', undefined, { push: send });
    const juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    const juan = await actor(t, 'juan', 'secreto1');
    expect((await juan.get('/api/me/push')).body).toEqual({ enabled: false, publicKey: null });
    expect((await juan.post('/api/me/push/subscribe', subscription(1))).status).toBe(409);
    await t.db.insert(pushSubscriptions).values({ userId: juanId, endpoint: subscription(1).endpoint, p256dh: 'p', auth: 'a' });
    await createNotification(t.db, { userId: juanId, kind: 'visits_today', title: 'x', body: 'y', refType: 't', refId: '1', day: '2025-06-15' });
    expect(send).not.toHaveBeenCalled();
    await t.close();
  });
});
