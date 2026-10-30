import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSessionToken, verifySessionToken } from '../auth.js';
import { certificates, clientContacts, clientLoginTokens, emailLog, invoices } from '../db/schema.js';
import type { MailProvider, OutgoingEmail } from '../mail/provider.js';
import { hashLoginToken } from '../services/portal.js';
import { writeStoredFile } from '../services/files.js';
import { makeTestApp, type TestApp } from './helpers.js';

const BASE = 'https://app.plagamix.example';
const PDF = Buffer.from('%PDF-1.4 portal test');

function capturingMail() {
  const sent: OutgoingEmail[] = [];
  const mail: MailProvider = {
    mode: 'simulated',
    from: 'Plagamix <test@plagamix.example>',
    async sendEmail(message) {
      sent.push(message);
      return { providerId: null };
    },
  };
  return { mail, sent };
}

const tokenOf = (m: OutgoingEmail) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

interface PortalFixture {
  t: TestApp;
  sent: OutgoingEmail[];
  clock: { now: number };
  filesDir: string;
}

async function fixture(config: Record<string, unknown> = {}, extra: { portalLimits?: { perEmail: number; perIp: number } } = {}): Promise<PortalFixture> {
  const filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-portal-'));
  const { mail, sent } = capturingMail();
  const clock = { now: Date.UTC(2025, 5, 15, 15) };
  const t = await makeTestApp('2025-06-15', mail, {
    config: { filesDir, publicBaseUrl: BASE, ...config },
    now: () => new Date(clock.now),
    ...extra,
  });
  return { t, sent, clock, filesDir };
}

/** Calls the API with a given cookie (none = anonymous). */
function as(t: TestApp, cookie?: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await t.app.request(path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  return { get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b) };
}

/** Lets the after-response mail jobs finish before the test database is closed. */
const settle = () => new Promise((r) => setTimeout(r, 150));

const cookieOf = (headers: Headers) => (headers.get('set-cookie') ?? '').split(';')[0] ?? '';

async function requestLink(f: PortalFixture, email: string) {
  const before = f.sent.length;
  const res = await as(f.t).post('/api/portal/login', { email });
  await vi.waitFor(() => expect(f.sent.length).toBe(before + 1));
  return { res, token: tokenOf(f.sent.at(-1)!) };
}

describe('client portal: magic link, data and isolation', () => {
  let f: PortalFixture;
  let t: TestApp;
  let alice: number; // Consorcio Alfa: email on the client
  let bruno: number; // Consorcio Beta: email on a contact
  let aliceInvoice: number;
  let brunoInvoice: number;
  let aliceCert: number;
  let brunoCert: number;

  beforeAll(async () => {
    f = await fixture();
    t = f.t;
    const service = (await t.post('/api/service-types', { name: 'Desinsectación', defaultPriceCents: 50_000_00, issuesCertificate: true, certificateValidityDays: 90 })).body.id;
    alice = (await t.post('/api/clients', { name: 'Consorcio Alfa', email: 'Admin@Alfa.test', phone: '1100000001' })).body.id;
    bruno = (await t.post('/api/clients', { name: 'Consorcio Beta', email: 'otro@beta.test' })).body.id;
    await t.db.insert(clientContacts).values({ clientId: bruno, name: 'Portero', email: 'Portero@Beta.test' });

    for (const [clientId, number] of [
      [alice, 'A-1'],
      [bruno, 'B-1'],
    ] as const) {
      const visit = await t.post('/api/visits', { clientId, serviceTypeId: service, date: '2025-06-01' });
      await t.post(`/api/visits/${visit.body.id}/complete`, { completedOn: '2025-06-01', createInvoice: true, issueCertificate: true, certificateNumber: number });
      await t.post('/api/visits', { clientId, serviceTypeId: service, date: '2025-07-10', time: '09:00' });
    }
    await t.post('/api/payments', { clientId: alice, amountCents: 10_000_00, method: 'transfer', paidOn: '2025-06-05' });

    aliceInvoice = (await t.db.select().from(invoices).where(eq(invoices.clientId, alice)))[0]!.id;
    brunoInvoice = (await t.db.select().from(invoices).where(eq(invoices.clientId, bruno)))[0]!.id;
    aliceCert = (await t.db.select().from(certificates).where(eq(certificates.clientId, alice)))[0]!.id;
    brunoCert = (await t.db.select().from(certificates).where(eq(certificates.clientId, bruno)))[0]!.id;
    for (const id of [aliceCert, brunoCert]) {
      await writeStoredFile(f.filesDir, `certificates/${id}.pdf`, PDF);
      await t.db.update(certificates).set({ fileKey: `certificates/${id}.pdf`, fileSize: PDF.length }).where(eq(certificates.id, id));
    }
  });
  afterAll(async () => {
    await t.close();
    await rm(f.filesDir, { recursive: true, force: true });
  });

  describe('requesting the link', () => {
    it('answers identically for a known and an unknown email, and mails only the known one', async () => {
      const known = await as(t).post('/api/portal/login', { email: 'admin@alfa.test' });
      await vi.waitFor(() => expect(f.sent.length).toBe(1));
      const unknown = await as(t).post('/api/portal/login', { email: 'nadie@nowhere.test' });
      await new Promise((r) => setTimeout(r, 100));
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(f.sent.length).toBe(1);
      expect(f.sent[0]).toMatchObject({ to: 'admin@alfa.test', tag: 'portal_login' });
      expect(f.sent[0]!.html).toContain(`${BASE}/portal/entrar?token=`);
    });

    it('matches emails case-insensitively on the client and on its contacts', async () => {
      const before = f.sent.length;
      await as(t).post('/api/portal/login', { email: 'ADMIN@alfa.TEST' });
      await as(t).post('/api/portal/login', { email: 'portero@beta.test' });
      await vi.waitFor(() => expect(f.sent.length).toBe(before + 2));
    });

    it('stores only the sha256 of the token, logs the mail and expires it in 30 minutes', async () => {
      const { token } = await requestLink(f, 'admin@alfa.test');
      const rows = await t.db.select().from(clientLoginTokens).where(eq(clientLoginTokens.tokenHash, hashLoginToken(token)));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]!.expiresAt.getTime() - f.clock.now).toBe(30 * 60_000);
      expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits
      const stored = await t.db.select().from(clientLoginTokens);
      expect(JSON.stringify(stored)).not.toContain(token);
      const logged = await t.db.select().from(emailLog).where(eq(emailLog.kind, 'portal_login'));
      expect(logged.length).toBeGreaterThan(0);
    });

    it('rejects a malformed email', async () => {
      expect((await as(t).post('/api/portal/login', { email: 'not-an-email' })).status).toBe(400);
    });
  });

  describe('opening the link', () => {
    it('logs the client in for 30 days and serves their data, once', async () => {
      const { token } = await requestLink(f, 'admin@alfa.test');
      const res = await as(t).post('/api/portal/verify', { token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', client: { id: alice, name: 'Consorcio Alfa' } });
      expect(res.headers.get('set-cookie')).toContain('Max-Age=2592000');
      expect(res.headers.get('set-cookie')).toContain('HttpOnly');
      const me = as(t, cookieOf(res.headers));

      expect((await me.get('/api/portal/me')).body).toEqual({ client: { id: alice, name: 'Consorcio Alfa' } });
      expect((await me.get('/api/auth/me')).body).toMatchObject({ role: 'client', clientId: alice, name: 'Consorcio Alfa' });

      const summary = (await me.get('/api/portal/summary')).body;
      expect(summary).toMatchObject({ balanceCents: 40_000_00, nextVisits: [{ date: '2025-07-10', time: '09:00' }], certificate: { number: 'A-1', valid: true } });

      const invs = (await me.get('/api/portal/invoices')).body;
      expect(invs).toHaveLength(1);
      expect(invs[0]).toMatchObject({ id: aliceInvoice, amountCents: 50_000_00, balanceCents: 40_000_00 });
      expect(invs[0].items.length).toBeGreaterThan(0);
      expect(JSON.stringify(invs)).not.toMatch(/arca|cae|cbte/i);

      const pays = (await me.get('/api/portal/payments')).body;
      expect(pays).toHaveLength(1);
      expect(pays[0]).toMatchObject({ amountCents: 10_000_00, method: 'transfer' });
      expect((await me.get('/api/portal/visits')).body.map((v: { status: string }) => v.status).sort()).toEqual(['done', 'scheduled']);
      expect((await me.get('/api/portal/certificates')).body[0]).toMatchObject({ id: aliceCert, hasFile: true });

      const pdf = await t.app.request(`/api/portal/certificates/${aliceCert}/file`, { headers: { cookie: cookieOf(res.headers) } });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
      expect(Buffer.from(await pdf.arrayBuffer()).equals(PDF)).toBe(true);

      // Single use.
      const again = await as(t).post('/api/portal/verify', { token });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('invalid_link');
    });

    it('rejects an unknown token and an expired one', async () => {
      expect((await as(t).post('/api/portal/verify', { token: 'x'.repeat(43) })).status).toBe(400);
      const { token } = await requestLink(f, 'admin@alfa.test');
      f.clock.now += 31 * 60_000;
      const late = await as(t).post('/api/portal/verify', { token });
      f.clock.now -= 31 * 60_000;
      expect(late.status).toBe(400);
      expect(late.headers.get('set-cookie')).toBeNull();
      // The failed attempt did not burn it: with the clock back inside the window it still opens.
      expect((await as(t).post('/api/portal/verify', { token })).status).toBe(200);
    });

    it('opens a link only once even when used concurrently', async () => {
      const { token } = await requestLink(f, 'portero@beta.test');
      const results = await Promise.all([as(t).post('/api/portal/verify', { token }), as(t).post('/api/portal/verify', { token })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('rejects a token whose client was archived since', async () => {
      const id = (await t.post('/api/clients', { name: 'Se va', email: 'seva@x.test' })).body.id;
      const { token } = await requestLink(f, 'seva@x.test');
      await t.post(`/api/clients/${id}/archive`);
      expect((await as(t).post('/api/portal/verify', { token })).status).toBe(400);
    });

    it('stops honouring a session once its client is archived', async () => {
      const id = (await t.post('/api/clients', { name: 'Se va luego', email: 'seva2@x.test' })).body.id;
      const { token } = await requestLink(f, 'seva2@x.test');
      const cookie = cookieOf((await as(t).post('/api/portal/verify', { token })).headers);
      expect((await as(t, cookie).get('/api/portal/me')).status).toBe(200);
      await t.post(`/api/clients/${id}/archive`);
      expect((await as(t, cookie).get('/api/portal/me')).status).toBe(401);
    });
  });

  describe('isolation between clients', () => {
    let aliceCookie: string;
    beforeAll(async () => {
      aliceCookie = `fumigadora_session=${createSessionToken(t.config, { role: 'client', clientId: alice })}`;
    });

    it("never returns another client's invoices, payments, visits or obleas", async () => {
      const me = as(t, aliceCookie);
      expect((await me.get('/api/portal/invoices')).body.map((i: { id: number }) => i.id)).toEqual([aliceInvoice]);
      expect((await me.get('/api/portal/invoices')).body.map((i: { id: number }) => i.id)).not.toContain(brunoInvoice);
      expect((await me.get('/api/portal/certificates')).body.map((c: { id: number }) => c.id)).toEqual([aliceCert]);
      const brunoSession = as(t, `fumigadora_session=${createSessionToken(t.config, { role: 'client', clientId: bruno })}`);
      expect((await brunoSession.get('/api/portal/payments')).body).toEqual([]);
    });

    it("answers 404 for another client's PDF and for unknown ids, and serves the own one", async () => {
      const me = as(t, aliceCookie);
      expect((await me.get(`/api/portal/certificates/${brunoCert}/file`)).status).toBe(404);
      expect((await me.get('/api/portal/certificates/999999/file')).status).toBe(404);
      expect((await t.app.request(`/api/portal/certificates/${aliceCert}/file`, { headers: { cookie: aliceCookie } })).status).toBe(200);
    });

    it('requires a client session on every data route', async () => {
      const paths = ['me', 'summary', 'visits', 'invoices', 'payments', 'certificates', `certificates/${aliceCert}/file`];
      for (const p of paths) {
        expect((await as(t).get(`/api/portal/${p}`)).status).toBe(401);
        // The owner and an employee are not clients either.
        expect((await as(t, t.cookie).get(`/api/portal/${p}`)).status).toBe(403);
      }
    });

    it('does not accept a forged or re-targeted client token', async () => {
      const real = createSessionToken(t.config, { role: 'client', clientId: alice });
      const [payload, signature] = real.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), cid: bruno })).toString('base64url');
      expect((await as(t, `fumigadora_session=${forged}.${signature}`).get('/api/portal/me')).status).toBe(401);
      expect(verifySessionToken(t.config, real)).toEqual({ role: 'client', clientId: alice });
      // A client token that also names a user id is not a valid identity.
      const mixed = Buffer.from(JSON.stringify({ exp: 9_999_999_999, role: 'client', cid: alice, uid: 1 })).toString('base64url');
      expect(verifySessionToken(t.config, `${mixed}.x`)).toBeNull();
    });
  });

  describe('client sessions on the staff API', () => {
    it('are rejected by every admin and employee route', async () => {
      const cookie = `fumigadora_session=${createSessionToken(t.config, { role: 'client', clientId: alice })}`;
      const open = /^\/api\/(health|auth|public|portal)(\/|$)/;
      const routes = t.app.routes.filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/') && !r.path.includes('*') && !open.test(r.path));
      expect(routes.length).toBeGreaterThan(80);
      for (const r of routes) {
        const path = r.path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, '1');
        const res = await t.app.request(path, {
          method: r.method,
          headers: { cookie, 'content-type': 'application/json' },
          ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: '{}' }),
        });
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
      }
    });

    it('cannot read clients, the PDF endpoint or the employee area', async () => {
      const me = as(t, `fumigadora_session=${createSessionToken(t.config, { role: 'client', clientId: alice })}`);
      expect((await me.get('/api/clients')).status).toBe(403);
      expect((await me.get(`/api/clients/${bruno}`)).status).toBe(403);
      expect((await me.get(`/api/clients/${bruno}/statement`)).status).toBe(403);
      expect((await me.get(`/api/certificates/${brunoCert}/file`)).status).toBe(403);
      expect((await me.get('/api/me/visits')).status).toBe(403);
      expect((await me.post('/api/me/visits/1/done', {})).status).toBe(403);
      expect((await me.get('/api/settings')).status).toBe(403);
    });
  });

  describe('a shared email', () => {
    let gamma: number;
    let delta: number;
    beforeAll(async () => {
      gamma = (await t.post('/api/clients', { name: 'Gamma', email: 'shared@admin.test' })).body.id;
      delta = (await t.post('/api/clients', { name: 'Delta' })).body.id;
      await t.db.insert(clientContacts).values({ clientId: delta, name: 'Admin', email: 'SHARED@admin.test' });
    });

    it('shows a picker with only the clients of that token, and no session yet', async () => {
      const { token } = await requestLink(f, 'shared@admin.test');
      const res = await as(t).post('/api/portal/verify', { token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'choose',
        clients: [
          { id: delta, name: 'Delta' },
          { id: gamma, name: 'Gamma' },
        ],
      });
      expect(res.headers.get('set-cookie')).toBeNull();
      expect((await as(t).get('/api/portal/me')).status).toBe(401);
    });

    it('binds the session to the chosen client once, and refuses clients outside the token', async () => {
      const { token } = await requestLink(f, 'shared@admin.test');
      // Alice is a real client but does not match this email.
      expect((await as(t).post('/api/portal/select', { token, clientId: alice })).status).toBe(400);
      expect((await as(t).post('/api/portal/select', { token, clientId: 999_999 })).status).toBe(400);
      // The failed attempts did not spend the token.
      const chosen = await as(t).post('/api/portal/select', { token, clientId: delta });
      expect(chosen.status).toBe(200);
      expect(chosen.body).toEqual({ status: 'ok', client: { id: delta, name: 'Delta' } });
      const me = as(t, cookieOf(chosen.headers));
      expect((await me.get('/api/portal/me')).body.client.id).toBe(delta);
      expect(verifySessionToken(t.config, cookieOf(chosen.headers).split('=')[1])).toEqual({ role: 'client', clientId: delta });
      expect((await as(t).post('/api/portal/select', { token, clientId: gamma })).status).toBe(400);
    });

    it('does not let a token for one email select with another token', async () => {
      const first = await requestLink(f, 'shared@admin.test');
      const other = await requestLink(f, 'admin@alfa.test');
      expect((await as(t).post('/api/portal/select', { token: other.token, clientId: gamma })).status).toBe(400);
      expect((await as(t).post('/api/portal/select', { token: first.token, clientId: gamma })).status).toBe(200);
    });
  });

  it('logs out', async () => {
    const { token } = await requestLink(f, 'admin@alfa.test');
    const cookie = cookieOf((await as(t).post('/api/portal/verify', { token })).headers);
    const out = await t.app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/fumigadora_session=;/);
  });
});

describe('portal rate limit and configuration', () => {
  it('limits requests per email, the same for known and unknown emails', async () => {
    const f = await fixture({}, { portalLimits: { perEmail: 2, perIp: 100 } });
    await f.t.post('/api/clients', { name: 'Uno', email: 'uno@x.test' });
    for (const email of ['uno@x.test', 'nadie@x.test']) {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await as(f.t).post('/api/portal/login', { email })).status);
      expect(statuses).toEqual([200, 200, 429, 429]);
    }
    await settle();
    await f.t.close();
    await rm(f.filesDir, { recursive: true, force: true });
  });

  it('limits requests per IP across emails', async () => {
    const f = await fixture({}, { portalLimits: { perEmail: 100, perIp: 3 } });
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await f.t.app.request('/api/portal/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ email: `u${i}@x.test` }),
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const other = await f.t.app.request('/api/portal/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ email: 'u9@x.test' }),
    });
    expect(other.status).toBe(200);
    await settle();
    await f.t.close();
    await rm(f.filesDir, { recursive: true, force: true });
  });

  it('in production without PUBLIC_BASE_URL sends no link (a spoofed Host must not shape it) but answers the same', async () => {
    const f = await fixture({ isProduction: true, publicBaseUrl: undefined });
    await f.t.post('/api/clients', { name: 'Uno', email: 'uno@x.test' });
    const res = await as(f.t).post('/api/portal/login', { email: 'uno@x.test' });
    expect(res.status).toBe(200);
    await settle();
    expect(f.sent).toHaveLength(0);
    await settle();
    await f.t.close();
    await rm(f.filesDir, { recursive: true, force: true });
  });

  it('outside production falls back to the request origin', async () => {
    const f = await fixture({ publicBaseUrl: undefined });
    await f.t.post('/api/clients', { name: 'Uno', email: 'uno@x.test' });
    await f.t.app.request('http://localhost:5173/api/portal/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uno@x.test' }),
    });
    await vi.waitFor(() => expect(f.sent).toHaveLength(1));
    expect(f.sent[0]!.text).toContain('http://localhost:5173/portal/entrar?token=');
    await settle();
    await f.t.close();
    await rm(f.filesDir, { recursive: true, force: true });
  });
});
