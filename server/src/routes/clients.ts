import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import {
  clientInput,
  clientListQuery,
  clientPatch,
  createClient,
  getClient,
  listClients,
  setArchived,
  updateClient,
} from '../services/clients.js';
import { clientStatement } from '../services/statement.js';

export function clientRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', clientListQuery), async (c) => c.json(await listClients(db, today(), c.req.valid('query'))))
    .post('/', v('json', clientInput), async (c) => c.json(await createClient(db, c.req.valid('json')), 201))
    .get('/:id', v('param', idParam), async (c) => c.json(await getClient(db, today(), c.req.valid('param').id)))
    .get('/:id/statement', v('param', idParam), async (c) =>
      c.json(await clientStatement(db, today(), c.req.valid('param').id)),
    )
    .patch('/:id', v('param', idParam), v('json', clientPatch), async (c) =>
      c.json(await updateClient(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/archive', v('param', idParam), async (c) => c.json(await setArchived(db, c.req.valid('param').id, true)))
    .post('/:id/unarchive', v('param', idParam), async (c) => c.json(await setArchived(db, c.req.valid('param').id, false)));
}
