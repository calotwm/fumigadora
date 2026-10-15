import { Hono } from 'hono';
import { v, type Deps } from '../http.js';
import { cashHandover, confirmHandover, confirmInput } from '../services/handover.js';

export function handoverRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await cashHandover(db)))
    .post('/confirm', v('json', confirmInput), async (c) => c.json(await confirmHandover(db, c.req.valid('json'))));
}
