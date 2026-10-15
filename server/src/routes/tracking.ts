import { Hono } from 'hono';
import { v, type Deps } from '../http.js';
import { scheduleInput, scheduleTracking, trackingBoard, trackingQuery } from '../services/tracking.js';

export function trackingRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', trackingQuery), async (c) => c.json(await trackingBoard(db, today(), c.req.valid('query'))))
    .post('/schedule', v('json', scheduleInput), async (c) => c.json(await scheduleTracking(db, c.req.valid('json')), 201));
}
