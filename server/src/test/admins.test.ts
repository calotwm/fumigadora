import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_PASSWORD, type TestApp } from './helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

async function login(t: TestApp, body: Record<string, unknown>) {
  const res = await t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
}

describe('admin users', () => {
  let t: TestApp;
  let adminId: number;
  let employeeId: number;
  let clientId: number;
  let serviceId: number;

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    const admin = await t.post('/api/users', {
      name: 'Dueña Prueba',
      username: 'duena',
      password: 'secreto1',
      role: 'admin',
      email: 'Duena@Example.com',
    });
    expect(admin.status).toBe(201);
    adminId = admin.body.id;
    employeeId = (await t.post('/api/users', { name: 'Técnico Uno', username: 'tecnico', password: 'secreto2', email: 'tecnico@example.com' })).body.id;
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno', phone: '1155551111', address: 'Calle 1' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
  });
  afterAll(() => t.close());

  it('stores a lowercase email and defaults "assignable" by role', async () => {
    const list = await t.get('/api/users');
    const admin = list.body.find((u: { id: number }) => u.id === adminId);
    const employee = list.body.find((u: { id: number }) => u.id === employeeId);
    expect(admin).toMatchObject({ role: 'admin', email: 'duena@example.com', assignable: false });
    expect(employee).toMatchObject({ role: 'employee', assignable: true });
  });

  it('rejects a duplicate or malformed email and clears an email with an empty string', async () => {
    const dup = await t.post('/api/users', { name: 'Otra', username: 'otra', password: 'secreto3', email: 'DUENA@example.com' });
    expect(dup.status).toBe(409);
    const bad = await t.post('/api/users', { name: 'Otra', username: 'otra', password: 'secreto3', email: 'no-es-un-mail' });
    expect(bad.status).toBe(400);
    const cleared = await t.patch(`/api/users/${employeeId}`, { email: '' });
    expect(cleared.body.email).toBeNull();
    const set = await t.patch(`/api/users/${employeeId}`, { email: 'tecnico@example.com' });
    expect(set.body.email).toBe('tecnico@example.com');
    // Keeping one's own email is not a duplicate.
    expect((await t.patch(`/api/users/${employeeId}`, { email: 'tecnico@example.com', name: 'Técnico Uno' })).status).toBe(200);
  });

  it('logs an admin user in with username and password and exposes their own id', async () => {
    const { res, cookie } = await login(t, { username: 'DUENA', password: 'secreto1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'admin', userId: adminId, name: 'Dueña Prueba' });
    const clients = await t.app.request('/api/clients', { headers: { cookie } });
    expect(clients.status).toBe(200);
  });

  it('keeps the emergency login userless', async () => {
    const { res, cookie } = await login(t, { password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const me = await json(await t.app.request('/api/auth/me', { headers: { cookie } }));
    expect(me).toMatchObject({ role: 'admin', name: 'Dueño' });
    expect(me.userId).toBeUndefined();
    // Without a user of its own, /api/me/visits needs ?userId=.
    expect((await t.app.request('/api/me/visits', { headers: { cookie } })).status).toBe(400);
    expect((await t.app.request(`/api/me/visits?userId=${employeeId}`, { headers: { cookie } })).status).toBe(200);
  });

  it('only accepts assignable users as assignees', async () => {
    const visit = { clientId, serviceTypeId: serviceId, date: '2025-06-15', time: '09:00' };
    const blocked = await t.post('/api/visits', { ...visit, assignedUserId: adminId });
    expect(blocked.status).toBe(409);
    const ok = await t.post('/api/visits', { ...visit, assignedUserId: employeeId });
    expect(ok.status).toBe(201);

    await t.patch(`/api/users/${adminId}`, { assignable: true });
    const nowOk = await t.post('/api/visits', { ...visit, assignedUserId: adminId });
    expect(nowOk.status).toBe(201);
  });

  it('lets an admin user act as themself in /api/me without ?userId', async () => {
    await t.patch(`/api/users/${adminId}`, { assignable: true });
    const { cookie } = await login(t, { username: 'duena', password: 'secreto1' });
    const mine = await t.app.request('/api/me/visits', { headers: { cookie } });
    expect(mine.status).toBe(200);
    const body = await json(mine);
    expect(body.visits.length).toBeGreaterThan(0);
    expect(body.visits.every((v: { assignedUserId: number }) => v.assignedUserId === adminId)).toBe(true);
    // ...and can still look at an employee through ?userId=.
    const theirs = await json(await t.app.request(`/api/me/visits?userId=${employeeId}`, { headers: { cookie } }));
    expect(theirs.visits.every((v: { assignedUserId: number }) => v.assignedUserId === employeeId)).toBe(true);
  });
});
