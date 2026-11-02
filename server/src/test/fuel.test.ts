import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import { form, HEIC, JPEG, login, PDF, PNG, send } from './uploads.js';

describe('fuel load with a photo (S4)', () => {
  let t: TestApp;
  let filesDir: string;
  let juan: string;
  let juanId: number;

  beforeAll(async () => {
    filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-fuel-'));
    t = await makeTestApp('2025-06-15', undefined, { config: { filesDir } });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    juan = await login(t, 'juan', 'secreto1');
  });
  afterAll(async () => {
    await t.close();
    await rm(filesDir, { recursive: true, force: true });
  });

  it('stores the load as a "Combustible" expense of the employee, keeping the photo under FILES_DIR', async () => {
    const photo = { bytes: PNG, type: 'image/png', name: '../../ticket.png' };
    const res = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '2500000', photo }));
    expect(res.status).toBe(201);
    // The employee only gets back what they loaded: nothing about balances or other money.
    expect(res.body).toEqual({ id: expect.any(Number), date: '2025-06-15', amountCents: 2_500_000 });
    // The stored name never comes from the client file name.
    expect((await readFile(join(filesDir, 'receipts', `${res.body.id}.png`))).equals(PNG)).toBe(true);

    const cats = (await t.get('/api/expense-categories')).body as { name: string }[];
    expect(cats.map((c) => c.name)).toEqual(['Combustible']);
    const movement = (await t.get('/api/finance/movements?month=2025-06')).body.movements[0];
    expect(movement).toMatchObject({
      type: 'expense',
      amountCents: 2_500_000,
      categoryName: 'Combustible',
      employeeId: juanId,
      employeeName: 'Juan Pérez',
      hasReceipt: true,
    });
    expect((await t.get('/api/finance/summary?month=2025-06')).body.expensesCents).toBe(2_500_000);
  });

  it('serves the photo to the admin only', async () => {
    const id = (await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '1000', date: '2025-06-14', photo: { bytes: HEIC, type: 'image/heic', name: 'x.heic' } }))).body.id;
    const admin = await send(t, t.cookie, 'GET', `/api/cash-entries/${id}/receipt`);
    expect(admin.status).toBe(200);
    expect(admin.headers.get('content-type')).toBe('image/heic');
    expect(admin.headers.get('cache-control')).toBe('private, no-store');
    expect((admin.body as Buffer).equals(HEIC)).toBe(true);
    expect((await send(t, juan, 'GET', `/api/cash-entries/${id}/receipt`)).status).toBe(403);
    expect((await t.app.request(`/api/cash-entries/${id}/receipt`)).status).toBe(401);
  });

  it('answers 404 for an entry without a photo', async () => {
    const cat = (await t.get('/api/expense-categories')).body[0].id;
    const plain = (await t.post('/api/cash-entries', { kind: 'expense', amountCents: 100, categoryId: cat })).body;
    expect(plain.hasReceipt).toBe(false);
    expect((await send(t, t.cookie, 'GET', `/api/cash-entries/${plain.id}/receipt`)).status).toBe(404);
  });

  it('rejects a missing photo, a file that is not an image and a bad amount', async () => {
    const missing = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '1000' }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe('Adjuntá la foto del ticket');

    const pdf = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '1000', photo: { bytes: PDF, type: 'application/pdf', name: 't.pdf' } }));
    expect(pdf.status).toBe(400);
    expect(pdf.body.error.code).toBe('invalid_file');
    // The declared type is not trusted: the bytes must be an image too.
    const fake = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '1000', photo: { bytes: PDF, type: 'image/png', name: 't.png' } }));
    expect(fake.status).toBe(400);

    const zero = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '0', photo: { bytes: JPEG, type: 'image/jpeg', name: 't.jpg' } }));
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('validation');
  });

  it('rejects a photo over 10 MB', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
    const res = await send(t, juan, 'POST', '/api/me/fuel', form({ amountCents: '1000', photo: { bytes: big, type: 'image/jpeg', name: 'big.jpg' } }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
  });
});

describe('fuel category', () => {
  it('reuses an existing "Nafta" category instead of creating "Combustible"', async () => {
    const filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-fuel-'));
    const t = await makeTestApp('2025-06-15', undefined, { config: { filesDir } });
    try {
      const nafta = (await t.post('/api/expense-categories', { name: 'Nafta' })).body.id;
      await t.post('/api/users', { name: 'Ana', username: 'ana', password: 'secreto1' });
      const ana = await login(t, 'ana', 'secreto1');
      const res = await send(t, ana, 'POST', '/api/me/fuel', form({ amountCents: '500', photo: { bytes: JPEG, type: 'image/jpeg', name: 'a.jpg' } }));
      expect(res.status).toBe(201);
      const entries = (await t.get('/api/cash-entries?month=2025-06')).body;
      expect(entries[0]).toMatchObject({ categoryId: nafta, employeeName: 'Ana', hasReceipt: true });
      expect((await t.get('/api/expense-categories')).body).toHaveLength(1);
    } finally {
      await t.close();
      await rm(filesDir, { recursive: true, force: true });
    }
  });
});
