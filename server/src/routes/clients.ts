import { Hono } from 'hono';
import { z } from 'zod';
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
import { ensurePublicToken, placardList, placardZones, publicBaseUrl, publicUrl, regeneratePublicToken } from '../services/publicLink.js';
import { clientStatement } from '../services/statement.js';

export function clientRoutes({ db, config, today }: Deps) {
  return new Hono()
    .get('/', v('query', clientListQuery), async (c) => c.json(await listClients(db, today(), c.req.valid('query'))))
    .post('/', v('json', clientInput), async (c) => c.json(await createClient(db, c.req.valid('json')), 201))
    // Printable placards: active clients (one zone, or all) with their public link. Before `/:id` so it is not read as an id.
    .get('/placards', v('query', z.object({ area: z.string().trim().max(120).optional() })), async (c) => {
      const base = publicBaseUrl(config, c);
      return c.json({ zones: await placardZones(db), items: await placardList(db, base, c.req.valid('query').area) });
    })
    .get('/:id', v('param', idParam), async (c) => c.json(await getClient(db, today(), c.req.valid('param').id)))
    .get('/:id/statement', v('param', idParam), async (c) =>
      c.json(await clientStatement(db, today(), c.req.valid('param').id)),
    )
    .patch('/:id', v('param', idParam), v('json', clientPatch), async (c) =>
      c.json(await updateClient(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .get('/:id/public-link', v('param', idParam), async (c) => {
      const token = await ensurePublicToken(db, c.req.valid('param').id);
      return c.json({ token, url: publicUrl(publicBaseUrl(config, c), token) });
    })
    // The old link stops working at once; a printed placard has to be replaced.
    .post('/:id/public-link/regenerate', v('param', idParam), async (c) => {
      const token = await regeneratePublicToken(db, c.req.valid('param').id);
      return c.json({ token, url: publicUrl(publicBaseUrl(config, c), token) });
    })
    .post('/:id/archive', v('param', idParam), async (c) => c.json(await setArchived(db, c.req.valid('param').id, true)))
    .post('/:id/unarchive', v('param', idParam), async (c) => c.json(await setArchived(db, c.req.valid('param').id, false)));
}
