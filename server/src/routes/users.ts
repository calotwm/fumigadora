import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import { createUser, listUsers, passwordInput, resetPassword, updateUser, userInput, userPatch } from '../services/users.js';

export function userRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await listUsers(db)))
    .post('/', v('json', userInput), async (c) => c.json(await createUser(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', userPatch), async (c) =>
      c.json(await updateUser(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .post('/:id/password', v('param', idParam), v('json', passwordInput), async (c) =>
      c.json(await resetPassword(db, c.req.valid('param').id, c.req.valid('json').password)),
    );
}
