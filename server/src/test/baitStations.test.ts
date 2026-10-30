import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';
import { form, JPEG, login, PDF, PNG, send } from './uploads.js';

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe('bait stations and client documents (S6)', () => {
  let t: TestApp;
  let filesDir: string;
  let juan: string;
  let juanId: number;
  let clientId: number;
  let otherClientId: number;
  let visitId: number;
  let stationId: number;

  beforeAll(async () => {
    filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-bait-'));
    t = await makeTestApp('2025-06-15', undefined, { config: { filesDir } });
    juanId = (await t.post('/api/users', { name: 'Juan Pérez', username: 'juan', password: 'secreto1' })).body.id;
    juan = await login(t, 'juan', 'secreto1');
    clientId = (await t.post('/api/clients', { name: 'Depósito Norte' })).body.id;
    otherClientId = (await t.post('/api/clients', { name: 'Otro Cliente' })).body.id;
    const serviceId = (await t.post('/api/service-types', { name: 'Desratización' })).body.id;
    visitId = (await t.post('/api/visits', { clientId, serviceTypeId: serviceId, date: '2025-06-15', assignedUserId: juanId })).body.id;
    // The client also owes money: none of it may reach the employee screens.
    await t.post('/api/invoices', { clientId, amountCents: 9_999_00, issuedOn: '2025-05-01' });
  });
  afterAll(async () => {
    await t.close();
    await rm(filesDir, { recursive: true, force: true });
  });

  it('creates stations with a code and a location reference', async () => {
    const res = await t.post('/api/bait-stations', { clientId, code: 'E1', reference: 'Portón de entrada, lado izquierdo' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), clientId, code: 'E1', reference: 'Portón de entrada, lado izquierdo', hasPhoto: false });
    stationId = res.body.id;
    await t.post('/api/bait-stations', { clientId, code: 'E2' });
    await t.post('/api/bait-stations', { clientId: otherClientId, code: 'E1' });
    const list = (await t.get(`/api/bait-stations?clientId=${clientId}`)).body;
    expect(list.stations.map((s: { code: string }) => s.code)).toEqual(['E1', 'E2']);
    expect(list.documents).toEqual([]);
  });

  it('validates stations', async () => {
    expect((await t.post('/api/bait-stations', { clientId, code: '' })).status).toBe(400);
    expect((await t.post('/api/bait-stations', { clientId: 999_999, code: 'X' })).status).toBe(400);
    expect((await t.post('/api/bait-stations', { clientId, code: 'E1' })).status).toBe(409);
    const patched = await t.patch(`/api/bait-stations/${stationId}`, { reference: 'Portón, izquierda' });
    expect(patched.body.reference).toBe('Portón, izquierda');
  });

  it('stores a station photo under FILES_DIR and replaces it', async () => {
    const put = await send(t, t.cookie, 'PUT', `/api/bait-stations/${stationId}/photo`, form({ photo: { bytes: PNG, type: 'image/png', name: '../x.png' } }));
    expect(put.status).toBe(200);
    expect(put.body.hasPhoto).toBe(true);
    expect(await exists(join(filesDir, 'bait-stations', `${stationId}.png`))).toBe(true);

    await send(t, t.cookie, 'PUT', `/api/bait-stations/${stationId}/photo`, form({ photo: { bytes: JPEG, type: 'image/jpeg', name: 'y.jpg' } }));
    expect(await exists(join(filesDir, 'bait-stations', `${stationId}.png`))).toBe(false);
    const photo = await send(t, t.cookie, 'GET', `/api/bait-stations/${stationId}/photo`);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect((photo.body as Buffer).equals(JPEG)).toBe(true);

    const pdf = await send(t, t.cookie, 'PUT', `/api/bait-stations/${stationId}/photo`, form({ photo: { bytes: PDF, type: 'image/png', name: 'p.png' } }));
    expect(pdf.status).toBe(400);
    expect(pdf.body.error.code).toBe('invalid_file');
  });

  it('uploads PDF documents for the client and serves them', async () => {
    const res = await send(t, t.cookie, 'POST', '/api/client-documents', form({ clientId: String(clientId), name: 'Plano de cebaderos', file: { bytes: PDF, type: 'application/pdf', name: '../../plano.pdf' } }));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), clientId, name: 'Plano de cebaderos', size: PDF.length, createdAt: expect.any(String) });
    expect((await readFile(join(filesDir, 'client-documents', `${res.body.id}.pdf`))).equals(PDF)).toBe(true);
    const file = await send(t, t.cookie, 'GET', `/api/client-documents/${res.body.id}/file`);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect((file.body as Buffer).equals(PDF)).toBe(true);
    expect((await t.get(`/api/bait-stations?clientId=${clientId}`)).body.documents).toHaveLength(1);

    // The display name defaults to the uploaded file's base name.
    const unnamed = await send(t, t.cookie, 'POST', '/api/client-documents', form({ clientId: String(clientId), file: { bytes: PDF, type: 'application/pdf', name: 'C:\\docs\\plano viejo.pdf' } }));
    expect(unnamed.body.name).toBe('plano viejo.pdf');

    const image = await send(t, t.cookie, 'POST', '/api/client-documents', form({ clientId: String(clientId), file: { bytes: PNG, type: 'image/png', name: 'a.png' } }));
    expect(image.status).toBe(400);
    const noClient = await send(t, t.cookie, 'POST', '/api/client-documents', form({ clientId: '999999', file: { bytes: PDF, type: 'application/pdf', name: 'a.pdf' } }));
    expect(noClient.status).toBe(400);

    expect((await t.del(`/api/client-documents/${unnamed.body.id}`)).body).toEqual({ ok: true });
    expect(await exists(join(filesDir, 'client-documents', `${unnamed.body.id}.pdf`))).toBe(false);
  });

  it('shows the employee the stations of their visit, read-only and without money', async () => {
    const res = await send(t, juan, 'GET', `/api/me/visits/${visitId}/bait-stations`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clientId,
      clientName: 'Depósito Norte',
      stations: [
        { id: stationId, code: 'E1', reference: 'Portón, izquierda', hasPhoto: true },
        { id: expect.any(Number), code: 'E2', reference: '', hasPhoto: false },
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/balance|Cents|debt|overdue/i);
    const photo = await send(t, juan, 'GET', `/api/me/bait-stations/${stationId}/photo`);
    expect(photo.status).toBe(200);
    expect((photo.body as Buffer).equals(JPEG)).toBe(true);
  });

  it('hides other clients and admin routes from the employee', async () => {
    const other = (await t.get(`/api/bait-stations?clientId=${otherClientId}`)).body.stations[0].id;
    expect((await send(t, juan, 'GET', `/api/me/bait-stations/${other}/photo`)).status).toBe(404);
    const someoneElse = (await t.post('/api/visits', { clientId: otherClientId, serviceTypeId: 1, date: '2025-06-15' })).body.id;
    expect((await send(t, juan, 'GET', `/api/me/visits/${someoneElse}/bait-stations`)).status).toBe(404);
    expect((await send(t, juan, 'GET', `/api/bait-stations?clientId=${clientId}`)).status).toBe(403);
    expect((await send(t, juan, 'PUT', `/api/bait-stations/${stationId}/photo`, form({ photo: { bytes: PNG, type: 'image/png', name: 'x.png' } }))).status).toBe(403);
    expect((await send(t, juan, 'GET', `/api/client-documents/1/file`)).status).toBe(403);
  });

  it('deletes a station with its photo', async () => {
    expect((await t.del(`/api/bait-stations/${stationId}`)).body).toEqual({ ok: true });
    expect(await exists(join(filesDir, 'bait-stations', `${stationId}.jpg`))).toBe(false);
    expect((await t.get(`/api/bait-stations?clientId=${clientId}`)).body.stations).toHaveLength(1);
  });
});
