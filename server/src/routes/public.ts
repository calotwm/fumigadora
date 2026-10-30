import { Hono } from 'hono';
import { publicClientView } from '../services/publicLink.js';
import type { Deps } from '../http.js';

/** Unauthenticated routes. Everything here is reachable by anyone who scans a placard, so payloads stay minimal. */
export function publicRoutes({ db, today }: Deps) {
  return new Hono().get('/clients/:token', async (c) => {
    const view = await publicClientView(db, today(), c.req.param('token'));
    return c.json(view, 200, {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    });
  });
}
