import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotification } from '../services/notifications.js';
import { makeTestApp, type ApiResult, type TestApp } from './helpers.js';

async function actor(t: TestApp, username: string, password: string) {
  const res = await t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const call = async (method: string, path: string): Promise<ApiResult> => {
    const r = await t.app.request(path, { method, headers: { cookie, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { get: (p: string) => call('GET', p), post: (p: string) => call('POST', p) };
}

describe('notifications', () => {
  let t: TestApp;
  let juanId: number;
  let pabloId: number;
  let adminId: number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    pabloId = (await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' })).body.id;
    adminId = (await t.post('/api/users', { name: 'Dueña Prueba', username: 'duena', password: 'secreto3', role: 'admin' })).body.id;
  });
  afterAll(() => t.close());

  const notify = (userId: number, refId: string, title = 'Aviso de prueba') =>
    createNotification(t.db, { userId, kind: 'visits_today', title, body: 'Detalle', link: '/app', refType: 'test', refId, day: '2025-06-15' });

  it('creates a notification once per dedupe key', async () => {
    expect(await notify(juanId, 'dup')).not.toBeNull();
    expect(await notify(juanId, 'dup')).toBeNull();
    // Same event for another user is a different notification.
    expect(await notify(pabloId, 'dup')).not.toBeNull();
  });

  it('lists only the caller notifications, newest first, with the unread count', async () => {
    await notify(juanId, 'second', 'Segundo');
    const juan = await actor(t, 'juan', 'secreto1');
    const res = await juan.get('/api/me/notifications');
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(2);
    expect(res.body.items.map((n: { title: string }) => n.title)).toEqual(['Segundo', 'Aviso de prueba']);
    expect(res.body.items[0]).toMatchObject({ kind: 'visits_today', body: 'Detalle', link: '/app', readAt: null });

    const pablo = await actor(t, 'pablo', 'secreto2');
    expect((await pablo.get('/api/me/notifications')).body.items).toHaveLength(1);
  });

  it('marks one as read, treats a repeat as fine and hides other users notifications', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    const pablo = await actor(t, 'pablo', 'secreto2');
    const [first] = (await juan.get('/api/me/notifications')).body.items;
    expect((await pablo.post(`/api/me/notifications/${first.id}/read`)).status).toBe(404);
    expect((await juan.post(`/api/me/notifications/${first.id}/read`)).status).toBe(200);
    expect((await juan.post(`/api/me/notifications/${first.id}/read`)).status).toBe(200);
    const after = (await juan.get('/api/me/notifications')).body;
    expect(after.unreadCount).toBe(1);
    expect(after.items.find((n: { id: number }) => n.id === first.id).readAt).not.toBeNull();
    expect((await juan.post('/api/me/notifications/999999/read')).status).toBe(404);
  });

  it('marks all as read for the caller only', async () => {
    const juan = await actor(t, 'juan', 'secreto1');
    const pablo = await actor(t, 'pablo', 'secreto2');
    const res = await juan.post('/api/me/notifications/read-all');
    expect(res.body).toMatchObject({ ok: true, updated: 1 });
    expect((await juan.get('/api/me/notifications')).body.unreadCount).toBe(0);
    expect((await pablo.get('/api/me/notifications')).body.unreadCount).toBe(1);
  });

  it('gives admin users their own list and the emergency session an empty one', async () => {
    await notify(adminId, 'admin-only', 'Para la dueña');
    const duena = await actor(t, 'duena', 'secreto3');
    const mine = await duena.get('/api/me/notifications');
    expect(mine.body.items.map((n: { title: string }) => n.title)).toEqual(['Para la dueña']);

    // The test app is logged in with the emergency password: no user, no notifications, no error.
    const emergency = await t.get('/api/me/notifications');
    expect(emergency.status).toBe(200);
    expect(emergency.body).toEqual({ unreadCount: 0, items: [] });
    expect((await t.post('/api/me/notifications/read-all')).body).toMatchObject({ ok: true, updated: 0 });
    expect((await t.post('/api/me/notifications/1/read')).status).toBe(404);
  });

  it('requires a session', async () => {
    expect((await t.app.request('/api/me/notifications')).status).toBe(401);
  });
});
