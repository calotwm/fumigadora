import { Hono } from 'hono';
import type { Deps } from '../http.js';
import { arcaStatus, checkArca } from '../arca/service.js';

/** The whole `/api` tree below the admin guard is owner-only, so these routes are admin only. */
export function arcaRoutes(deps: Deps) {
  return new Hono()
    .get('/status', (c) => c.json(arcaStatus(deps)))
    .post('/check', async (c) => c.json(await checkArca(deps)));
}
