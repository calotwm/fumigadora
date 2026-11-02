import { Hono } from 'hono';
import { monthOf } from '@fumigadora/shared';
import { z } from 'zod';
import { idParam, v, zMonth, type Deps } from '../http.js';
import {
  createMovement,
  createProduct,
  deleteMovement,
  listMovements,
  listProducts,
  movementInput,
  movementListQuery,
  productInput,
  productPatch,
  stockUsage,
  updateProduct,
} from '../services/stock.js';

/** Products catalog with current stock (owner only). Employees pick products through `GET /api/me/products`. */
export function productRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await listProducts(db)))
    .post('/', v('json', productInput), async (c) => c.json(await createProduct(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', productPatch), async (c) =>
      c.json(await updateProduct(db, c.req.valid('param').id, c.req.valid('json'))),
    );
}

/** Stock movements and usage (owner only). */
export function stockRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/movements', v('query', movementListQuery), async (c) => c.json(await listMovements(db, today(), c.req.valid('query'))))
    .post('/movements', v('json', movementInput), async (c) => c.json(await createMovement(db, today(), c.req.valid('json')), 201))
    .delete('/movements/:id', v('param', idParam), async (c) => c.json(await deleteMovement(db, c.req.valid('param').id)))
    .get('/usage', v('query', z.object({ month: zMonth.optional() })), async (c) =>
      c.json(await stockUsage(db, c.req.valid('query').month ?? monthOf(today()))),
    );
}
