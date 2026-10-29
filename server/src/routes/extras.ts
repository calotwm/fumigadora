import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import { createExtra, deleteExtra, extraInput, extraPatch, listExtras, updateExtra } from '../services/extras.js';

/** Extras catalog administration (owner only). Employees read the active ones through `GET /api/me/extras`. */
export function extraRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await listExtras(db)))
    .post('/', v('json', extraInput), async (c) => c.json(await createExtra(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', extraPatch), async (c) =>
      c.json(await updateExtra(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteExtra(db, c.req.valid('param').id)));
}
