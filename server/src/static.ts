import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

/** Finds the built SPA folder (`web/dist`) relative to the server (src, dist) or the cwd. */
export function findWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../web/dist'),
    resolve(here, '../web/dist'),
    resolve(process.cwd(), 'web/dist'),
    resolve(process.cwd(), '../web/dist'),
  ];
  return candidates.find((p) => existsSync(join(p, 'index.html'))) ?? null;
}

/** Serves static files with SPA fallback to index.html for any non-/api GET. Safe when the folder is missing. */
export function mountStatic(app: Hono, root: string | null = findWebDist()) {
  if (!root) return false;
  const base = resolve(root);
  app.get('*', async (c) => {
    const path = c.req.path;
    if (path === '/api' || path.startsWith('/api/')) return c.notFound();
    const relative = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
    const candidate = resolve(base, relative);
    if (candidate !== base && !candidate.startsWith(base + sep)) return c.notFound();

    let file = candidate;
    const isAsset = relative !== '' && existsSync(file) && statSync(file).isFile();
    if (!isAsset) {
      // A missing file with an extension is a real 404; anything else is an SPA route.
      if (extname(relative) !== '') return c.notFound();
      file = join(base, 'index.html');
    }
    const body = await readFile(file);
    const headers: Record<string, string> = { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' };
    headers['Cache-Control'] = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return c.body(new Uint8Array(body), 200, headers);
  });
  return true;
}
