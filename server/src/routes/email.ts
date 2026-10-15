import { Hono } from 'hono';
import { idParam, v, type Deps } from '../http.js';
import { emailStatus, getLog, listLog, logQuery, sendTest, testInput } from '../services/mail.js';

export function emailRoutes({ db, mail, today }: Deps) {
  return new Hono()
    .get('/status', (c) => c.json(emailStatus(mail)))
    .get('/log', v('query', logQuery), async (c) => c.json(await listLog(db, c.req.valid('query'))))
    .get('/log/:id', v('param', idParam), async (c) => c.json(await getLog(db, c.req.valid('param').id)))
    .post('/test', v('json', testInput), async (c) => c.json(await sendTest(db, mail, today(), c.req.valid('json').to), 201));
}
