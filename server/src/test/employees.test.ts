import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, TEST_PASSWORD, type ApiResult, type TestApp } from './helpers.js';

interface Actor {
  cookie: string;
  get(path: string): Promise<ApiResult>;
  post(path: string, body?: unknown): Promise<ApiResult>;
  patch(path: string, body: unknown): Promise<ApiResult>;
}

async function loginRaw(t: TestApp, body: Record<string, unknown>) {
  return t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function actor(t: TestApp, username: string, password: string): Promise<Actor> {
  const res = await loginRaw(t, { username, password });
  expect(res.status).toBe(200);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const call = async (method: string, path: string, body?: unknown): Promise<ApiResult> => {
    const r = await t.app.request(path, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return {
    cookie,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b),
  };
}

describe('employees', () => {
  let t: TestApp;
  let juan: Actor;
  let pablo: Actor;
  let juanId: number;
  let pabloId: number;
  let clientId: number;
  let serviceId: number;
  let certServiceId: number;

  async function newVisit(extra: Record<string, unknown> = {}) {
    const res = await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', time: '09:00', ...extra });
    expect(res.status).toBe(201);
    return res.body as { id: number; assignedUserId: number | null; assigneeName: string | null };
  }

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    const j = await t.post('/api/users', { name: 'Juan Pérez', username: 'Juan', password: 'secreto1' });
    const p = await t.post('/api/users', { name: 'Pablo Gómez', username: 'pablo', password: 'secreto2' });
    juanId = j.body.id;
    pabloId = p.body.id;
    clientId = (await t.post('/api/clients', { name: 'Cliente Uno', phone: '1155551111', address: 'Calle 1' })).body.id;
    serviceId = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00 })).body.id;
    certServiceId = (
      await t.post('/api/service-types', { name: 'Tanque', defaultPriceCents: 70_000_00, issuesCertificate: true, certificateValidityDays: 180 })
    ).body.id;
    juan = await actor(t, 'juan', 'secreto1');
    pablo = await actor(t, 'pablo', 'secreto2');
  });
  afterAll(() => t.close());

  describe('users admin', () => {
    it('never returns password hashes and lowercases the username', async () => {
      const list = await t.get('/api/users');
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|scrypt/);
      expect(list.body.find((u: { id: number }) => u.id === juanId)).toMatchObject({ username: 'juan', role: 'employee', active: true });
    });

    it('rejects a duplicate username and a short password', async () => {
      const dup = await t.post('/api/users', { name: 'Otro', username: 'JUAN', password: 'secreto1' });
      expect(dup.status).toBe(409);
      const short = await t.post('/api/users', { name: 'Otro', username: 'otro', password: '123' });
      expect(short.status).toBe(400);
    });
  });

  describe('login', () => {
    it('keeps the owner login (password only) working and reports the role', async () => {
      const res = await loginRaw(t, { password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ authenticated: true, role: 'admin' });
      const me = await t.get('/api/auth/me');
      expect(me.body).toMatchObject({ role: 'admin', name: 'Dueño' });
      expect(me.body.userId).toBeUndefined();
    });

    it('logs an employee in with username and password (username is case-insensitive)', async () => {
      const res = await loginRaw(t, { username: 'JUAN', password: 'secreto1' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'employee', userId: juanId, name: 'Juan Pérez' });
      const me = await juan.get('/api/auth/me');
      expect(me.body).toMatchObject({ role: 'employee', userId: juanId, name: 'Juan Pérez' });
    });

    it('rejects wrong credentials without telling which part failed', async () => {
      expect((await loginRaw(t, { username: 'juan', password: 'mal' })).status).toBe(401);
      expect((await loginRaw(t, { username: 'nadie', password: 'secreto1' })).status).toBe(401);
      // The owner password is not an employee password.
      expect((await loginRaw(t, { username: 'juan', password: TEST_PASSWORD })).status).toBe(401);
    });

    it('locks out a deactivated employee immediately, even with a valid cookie', async () => {
      const u = await t.post('/api/users', { name: 'Temporal', username: 'temporal', password: 'secreto3' });
      const temp = await actor(t, 'temporal', 'secreto3');
      expect((await temp.get('/api/me/visits')).status).toBe(200);
      expect((await t.patch(`/api/users/${u.body.id}`, { active: false })).status).toBe(200);
      expect((await temp.get('/api/me/visits')).status).toBe(401);
      expect((await loginRaw(t, { username: 'temporal', password: 'secreto3' })).status).toBe(401);
    });

    it('resets a password', async () => {
      const u = await t.post('/api/users', { name: 'Reset', username: 'reset', password: 'viejo123' });
      expect((await t.post(`/api/users/${u.body.id}/password`, { password: 'nuevo123' })).status).toBe(200);
      expect((await loginRaw(t, { username: 'reset', password: 'viejo123' })).status).toBe(401);
      expect((await loginRaw(t, { username: 'reset', password: 'nuevo123' })).status).toBe(200);
    });

    it('rejects a forged role in the cookie', async () => {
      const [payload] = juan.cookie.replace('fumigadora_session=', '').split('.');
      const data = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
      const forged = Buffer.from(JSON.stringify({ ...data, role: 'admin' })).toString('base64url');
      const res = await t.app.request('/api/clients', { headers: { cookie: `fumigadora_session=${forged}.${'a'.repeat(43)}` } });
      expect(res.status).toBe(401);
    });
  });

  describe('role isolation', () => {
    it('answers 403 to employees on every admin route', async () => {
      for (const path of [
        '/api/clients',
        '/api/dashboard',
        '/api/visits',
        '/api/invoices',
        '/api/payments',
        '/api/finance/summary',
        '/api/users',
        '/api/cash-handover',
        '/api/tracking',
        '/api/search?q=a',
      ]) {
        const res = await juan.get(path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code).toBe('forbidden');
      }
      expect((await juan.post('/api/users', { name: 'X', username: 'xxx', password: 'secreto1' })).status).toBe(403);
      expect((await juan.post('/api/cash-handover/confirm', { paymentIds: [1] })).status).toBe(403);
      expect((await juan.post('/api/visits/1/complete', {})).status).toBe(403);
    });

    it('answers 401 without a session on /api/me', async () => {
      expect((await t.app.request('/api/me/visits')).status).toBe(401);
    });

    it('lists only the visits assigned to the caller, with client data and balance', async () => {
      const mine = await newVisit({ assignedUserId: juanId });
      const theirs = await newVisit({ assignedUserId: pabloId, time: '10:00' });
      await newVisit({ time: '11:00' });
      await t.post('/api/invoices', { clientId, amountCents: 30_000_00, issuedOn: '2025-06-01' });

      const res = await juan.get('/api/me/visits');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2025-06-15');
      expect(res.body.visits.map((v: { id: number }) => v.id)).toEqual([mine.id]);
      expect(res.body.visits[0]).toMatchObject({
        clientName: 'Cliente Uno',
        clientAddress: 'Calle 1',
        clientPhone: '1155551111',
        serviceTypeName: 'Desinsectación',
        time: '09:00',
        status: 'scheduled',
        cashCollectedCents: 0,
      });
      // Employees see the route and what they collect, never the client's debt.
      expect(res.body.visits[0]).not.toHaveProperty('clientBalanceCents');
      expect(res.body.cashPending).toEqual({ cents: 0, count: 0 });

      const other = await pablo.get('/api/me/visits');
      expect(other.body.visits.map((v: { id: number }) => v.id)).toEqual([theirs.id]);
      expect((await juan.get('/api/me/visits?date=2025-06-16')).body.visits).toEqual([]);
    });

    it("hides other employees' visits when marking done (404) and cannot be bypassed with ?userId", async () => {
      const theirs = await newVisit({ assignedUserId: pabloId });
      expect((await juan.post(`/api/me/visits/${theirs.id}/done`, {})).status).toBe(404);
      expect((await juan.post(`/api/me/visits/${theirs.id}/done?userId=${pabloId}`, {})).status).toBe(404);
      expect((await juan.post('/api/me/visits/999999/done', {})).status).toBe(404);
      const still = await t.get(`/api/visits/${theirs.id}`);
      expect(still.body.status).toBe('scheduled');
    });

    it('lets the owner act as an employee for testing via ?userId', async () => {
      const res = await t.get(`/api/me/visits?userId=${pabloId}`);
      expect(res.status).toBe(200);
      expect((await t.get('/api/me/visits')).status).toBe(400);
    });
  });

  describe('visit assignment', () => {
    it('assigns on create, changes on patch, unassigns with null and filters by employee', async () => {
      const v = await newVisit({ assignedUserId: juanId, date: '2025-07-01' });
      expect(v).toMatchObject({ assignedUserId: juanId, assigneeName: 'Juan Pérez' });
      const moved = await t.patch(`/api/visits/${v.id}`, { assignedUserId: pabloId });
      expect(moved.body).toMatchObject({ assignedUserId: pabloId, assigneeName: 'Pablo Gómez' });
      const list = await t.get(`/api/visits?from=2025-07-01&to=2025-07-01&assignedUserId=${pabloId}`);
      expect(list.body.map((x: { id: number }) => x.id)).toEqual([v.id]);
      const cleared = await t.patch(`/api/visits/${v.id}`, { assignedUserId: null });
      expect(cleared.body).toMatchObject({ assignedUserId: null, assigneeName: null });
    });

    it('rejects unknown or deactivated assignees', async () => {
      expect((await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-07-02', assignedUserId: 99999 })).status).toBe(404);
      const u = await t.post('/api/users', { name: 'Baja', username: 'baja', password: 'secreto1' });
      await t.patch(`/api/users/${u.body.id}`, { active: false });
      expect((await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-07-02', assignedUserId: u.body.id })).status).toBe(409);
    });

    it('assigns through the monthly tracking schedule', async () => {
      const c = (await t.post('/api/clients', { name: 'Plan', serviceFrequency: 'monthly', defaultServiceTypeId: serviceId })).body.id;
      const res = await t.post('/api/tracking/schedule', { month: '2025-06', items: [{ clientId: c, date: '2025-06-20', assignedUserId: juanId }] });
      expect(res.status).toBe(201);
      expect(res.body.created[0]).toMatchObject({ assignedUserId: juanId });
    });
  });

  describe('marking done', () => {
    it('completes without cash: invoice from the visit price, next visit per frequency, no payment', async () => {
      const v = await newVisit({ assignedUserId: juanId, priceCents: 40_000_00, frequency: 'monthly', date: '2025-06-15', time: '12:00' });
      const res = await juan.post(`/api/me/visits/${v.id}/done`, {});
      expect(res.status).toBe(200);
      expect(res.body.visit.status).toBe('done');
      expect(res.body.invoice).toMatchObject({ amountCents: 40_000_00 });
      expect(res.body.nextVisit).toMatchObject({ date: '2025-07-15', assignedUserId: juanId });
      expect(res.body.payment).toBeNull();
      // Done twice -> conflict.
      expect((await juan.post(`/api/me/visits/${v.id}/done`, {})).status).toBe(409);
    });

    it('completes with the legacy cashCollectedCents: cash payment to the visit invoice first, collectedBy set, pending handover', async () => {
      const c = (await t.post('/api/clients', { name: 'Paga Efectivo' })).body.id;
      const oldInv = (await t.post('/api/invoices', { clientId: c, amountCents: 20_000_00, issuedOn: '2025-05-01' })).body;
      const v = (
        await t.post('/api/visits', { clientId: c, serviceTypeId: serviceId, date: '2025-06-15', priceCents: 50_000_00, assignedUserId: juanId })
      ).body;
      const res = await juan.post(`/api/me/visits/${v.id}/done`, { cashCollectedCents: 60_000_00 });
      expect(res.status).toBe(200);
      const { payment, invoice } = res.body;
      expect(payment.payment).toMatchObject({ amountCents: 60_000_00, method: 'cash', collectedByUserId: juanId, visitId: v.id, handedOverAt: null });
      // The visit's own invoice first (50k), the remainder FIFO to the old debt (10k of 20k).
      expect(payment.allocations.map((a: { invoiceId: number; amountCents: number }) => [a.invoiceId, a.amountCents])).toEqual([
        [invoice.id, 50_000_00],
        [oldInv.id, 10_000_00],
      ]);
      expect(payment.client.balanceCents).toBe(10_000_00);

      const mine = await juan.get('/api/me/visits');
      const row = mine.body.visits.find((x: { id: number }) => x.id === v.id);
      expect(row).toMatchObject({ status: 'done', cashCollectedCents: 60_000_00 });
      expect(mine.body.cashPending.cents).toBeGreaterThanOrEqual(60_000_00);
    });

    it('rejects invalid cash and leaves the visit scheduled', async () => {
      const v = await newVisit({ assignedUserId: juanId, time: '13:00' });
      const res = await juan.post(`/api/me/visits/${v.id}/done`, { cashCollectedCents: -5 });
      expect(res.status).toBe(400);
      expect((await t.get(`/api/visits/${v.id}`)).body.status).toBe('scheduled');
    });

    it('issues a certificate when the service type has one', async () => {
      const v = (await t.post('/api/visits', { clientId, serviceTypeId: certServiceId, date: '2025-06-15', assignedUserId: juanId })).body;
      const res = await juan.post(`/api/me/visits/${v.id}/done`, {});
      expect(res.status).toBe(200);
      expect(res.body.certificate).toMatchObject({ visitId: v.id, expiresOn: '2025-12-12' });
    });
  });

  describe('cash handover', () => {
    it('lists pending cash per employee and the owner confirms receipt', async () => {
      const before = await t.get('/api/cash-handover');
      expect(before.status).toBe(200);
      const juanBlock = before.body.employees.find((e: { userId: number }) => e.userId === juanId);
      expect(juanBlock.pendingCents).toBeGreaterThanOrEqual(60_000_00);
      expect(juanBlock.items[0]).toMatchObject({ clientName: expect.any(String), amountCents: expect.any(Number), visitId: expect.any(Number) });
      expect(before.body.pendingCents).toBe(before.body.employees.reduce((s: number, e: { pendingCents: number }) => s + e.pendingCents, 0));

      const dash = await t.get('/api/dashboard');
      expect(dash.body.cashPendingCents).toBe(before.body.pendingCents);
      expect(dash.body.cashPendingCount).toBe(before.body.pendingCount);

      const ids = juanBlock.items.map((i: { paymentId: number }) => i.paymentId);
      const confirm = await t.post('/api/cash-handover/confirm', { paymentIds: ids });
      expect(confirm.status).toBe(200);
      expect(confirm.body.confirmed).toBe(ids.length);

      const after = await t.get('/api/cash-handover');
      expect(after.body.employees.find((e: { userId: number }) => e.userId === juanId)).toBeUndefined();
      expect(after.body.recent.map((r: { paymentId: number }) => r.paymentId)).toEqual(expect.arrayContaining(ids));
      expect((await juan.get('/api/me/visits')).body.cashPending).toEqual({ cents: 0, count: 0 });
      expect((await t.get('/api/dashboard')).body.cashPendingCents).toBe(0);
    });

    it('refuses to confirm twice, unknown ids and non-employee payments', async () => {
      const recent = (await t.get('/api/cash-handover')).body.recent[0].paymentId;
      expect((await t.post('/api/cash-handover/confirm', { paymentIds: [recent] })).status).toBe(400);
      const owner = (await t.post('/api/payments', { clientId, amountCents: 1_000_00 })).body.payment.id;
      expect((await t.post('/api/cash-handover/confirm', { paymentIds: [owner] })).status).toBe(400);
      expect((await t.post('/api/cash-handover/confirm', { paymentIds: [] })).status).toBe(400);
    });
  });
});
