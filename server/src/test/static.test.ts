import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountStatic } from '../static.js';

describe('static SPA serving', () => {
  let dir: string;
  const app = new Hono();

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fumigadora-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("push", () => {})');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Plagamix"}');
    app.get('/api/ping', (c) => c.json({ ok: true }));
    expect(mountStatic(app, dir)).toBe(true);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves index.html at the root and for client-side routes', async () => {
    for (const path of ['/', '/clientes/12', '/agenda']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>spa</title>');
    }
  });

  it('serves assets with a long cache and the right type', async () => {
    const res = await app.request('/assets/app.js');
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('serves the manifest and the service worker with the right types and never caches the worker', async () => {
    const manifest = await app.request('/manifest.webmanifest');
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
    expect(await manifest.json()).toEqual({ name: 'Plagamix' });
    const sw = await app.request('/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers.get('content-type')).toContain('text/javascript');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('does not fall back to the SPA for missing files or /api paths', async () => {
    expect((await app.request('/missing.js')).status).toBe(404);
    expect((await app.request('/api/unknown')).status).toBe(404);
    expect((await app.request('/api/ping')).status).toBe(200);
  });

  it('refuses path traversal', async () => {
    const res = await app.request('/..%2f..%2fpackage.json');
    expect(res.status).toBe(404);
  });

  it('is a no-op when the web build folder does not exist', () => {
    expect(mountStatic(new Hono(), null)).toBe(false);
  });
});
