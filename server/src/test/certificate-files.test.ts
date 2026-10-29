import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificates } from '../db/schema.js';
import { writeStoredFile } from '../services/files.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('certificate file download', () => {
  let t: TestApp;
  let filesDir: string;
  let withFile: number;
  let withoutFile: number;
  const pdf = Buffer.from('%PDF-1.4 invented');

  beforeAll(async () => {
    filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-cert-'));
    t = await makeTestApp('2025-06-15', undefined, { config: { filesDir } });
    const clientId = (await t.post('/api/clients', { name: 'Cliente Uno', phone: '1155551111', address: 'Calle 1' })).body.id;
    const base = { clientId, issuedOn: '2025-06-01', expiresOn: '2025-12-01' };
    const [a, b] = await t.db
      .insert(certificates)
      .values([
        { ...base, number: 'A/1' },
        { ...base, number: '2' },
      ])
      .returning({ id: certificates.id });
    withFile = a!.id;
    withoutFile = b!.id;
    await writeStoredFile(filesDir, `certificates/${withFile}.pdf`, pdf);
    await t.db.update(certificates).set({ fileKey: `certificates/${withFile}.pdf`, fileSize: pdf.length }).where(eq(certificates.id, withFile));
  });
  afterAll(async () => {
    await t.close();
    await rm(filesDir, { recursive: true, force: true });
  });

  it('serves the PDF inline to the owner', async () => {
    const res = await t.app.request(`/api/certificates/${withFile}/file`, { headers: { cookie: t.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="oblea-A_1.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it('answers 404 when the certificate has no file or does not exist', async () => {
    for (const id of [withoutFile, 999_999]) {
      const res = await t.app.request(`/api/certificates/${id}/file`, { headers: { cookie: t.cookie } });
      expect(res.status).toBe(404);
    }
  });

  it('exposes hasFile in the certificate list', async () => {
    const list = (await t.get('/api/certificates')).body as { id: number; hasFile: boolean }[];
    expect(list.find((c) => c.id === withFile)?.hasFile).toBe(true);
    expect(list.find((c) => c.id === withoutFile)?.hasFile).toBe(false);
  });

  it('answers 401 without a session and 403 to employees', async () => {
    expect((await t.app.request(`/api/certificates/${withFile}/file`)).status).toBe(401);

    await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' });
    const login = await t.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'juan', password: 'secreto1' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const res = await t.app.request(`/api/certificates/${withFile}/file`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });
});
