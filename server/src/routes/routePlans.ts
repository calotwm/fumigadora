import { Hono } from 'hono';
import { z } from 'zod';
import { idParam, v, zMonth, type Deps } from '../http.js';
import { addItem, approveRoute, generateRoute, getRoute, itemInput, itemPatch, removeItem, updateItem } from '../services/routePlans.js';

const monthParam = z.object({ month: zMonth });

export function routePlanRoutes(deps: Deps) {
  const { db, today } = deps;
  return new Hono()
    .patch('/items/:id', v('param', idParam), v('json', itemPatch), async (c) =>
      c.json(await updateItem(db, today(), c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/items/:id', v('param', idParam), async (c) => c.json(await removeItem(db, today(), c.req.valid('param').id)))
    .get('/:month', v('param', monthParam), async (c) => c.json(await getRoute(db, today(), c.req.valid('param').month)))
    .post('/:month/generate', v('param', monthParam), async (c) => c.json(await generateRoute(db, today(), c.req.valid('param').month)))
    .post('/:month/items', v('param', monthParam), v('json', itemInput), async (c) =>
      c.json(await addItem(db, today(), c.req.valid('param').month, c.req.valid('json')), 201),
    )
    .post('/:month/approve', v('param', monthParam), async (c) => c.json(await approveRoute(deps, c.req.valid('param').month)));
}
