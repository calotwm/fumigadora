import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import {
  agendaSummary,
  cancelVisit,
  completeInput,
  completeVisit,
  createVisit,
  getVisit,
  listVisits,
  updateVisit,
  visitInput,
  visitListQuery,
  visitPatch,
} from '../services/visits.js';

export function visitRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', visitListQuery), async (c) => c.json(await listVisits(db, c.req.valid('query'))))
    .post('/', v('json', visitInput), async (c) => c.json(await createVisit(db, c.req.valid('json')), 201))
    .get('/:id', v('param', idParam), async (c) => c.json(await getVisit(db, c.req.valid('param').id)))
    .patch('/:id', v('param', idParam), v('json', visitPatch), async (c) =>
      c.json(await updateVisit(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/cancel', v('param', idParam), async (c) => c.json(await cancelVisit(db, c.req.valid('param').id)))
    .post('/:id/complete', v('param', idParam), v('json', completeInput), async (c) =>
      c.json(await completeVisit(db, today(), c.req.valid('param').id, c.req.valid('json'))),
    );
}

export function agendaRoutes({ db, today }: Deps) {
  return new Hono().get('/summary', async (c) => c.json(await agendaSummary(db, today())));
}
