import { Hono } from 'hono';
import type { AuthEnv } from '../auth.js';
import { v, type Deps } from '../http.js';
import { applyPriceAdjustment, listPriceAdjustments, previewPriceAdjustment, priceAdjustInput } from '../services/priceAdjust.js';

/** IPC price update (owner only, mounted behind the admin guard). */
export function priceAdjustmentRoutes({ db, today }: Deps) {
  return new Hono<AuthEnv>()
    .get('/', async (c) => c.json(await listPriceAdjustments(db)))
    .post('/preview', v('json', priceAdjustInput), async (c) => c.json(await previewPriceAdjustment(db, today(), c.req.valid('json'))))
    .post('/', v('json', priceAdjustInput), async (c) => {
      const session = c.get('session');
      const result = await applyPriceAdjustment(db, today(), c.req.valid('json'), { userId: session.userId ?? null, name: session.name });
      return c.json(result, 201);
    });
}
