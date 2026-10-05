import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import {
  categoryInput,
  createCategory,
  createServiceType,
  deleteCategory,
  deleteServiceType,
  listCategories,
  listServiceTypes,
  serviceTypeInput,
  serviceTypePatch,
  updateCategory,
  updateServiceType,
} from '../services/catalog.js';

export function serviceTypeRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await listServiceTypes(db)))
    .post('/', v('json', serviceTypeInput), async (c) => c.json(await createServiceType(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', serviceTypePatch), async (c) =>
      c.json(await updateServiceType(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteServiceType(db, c.req.valid('param').id)));
}

export function expenseCategoryRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await listCategories(db)))
    .post('/', v('json', categoryInput), async (c) => c.json(await createCategory(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', categoryInput), async (c) =>
      c.json(await updateCategory(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteCategory(db, c.req.valid('param').id)));
}
