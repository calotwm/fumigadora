import { Hono } from 'hono';
import type { AuthEnv, Session } from '../auth.js';
import { badRequest, idParam, v, type Deps } from '../http.js';
import { markMyVisitDone, myDoneInput, myVisits, myVisitsQuery } from '../services/employee.js';

/**
 * Employee-facing routes. An employee always acts as themselves; an admin may pass `?userId=` to act
 * as an employee (testing). The owner login has no user id of its own.
 */
export function meRoutes({ db, today }: Deps) {
  const actingUser = (session: Session, requested?: number): number => {
    const id = session.role === 'employee' ? session.userId : (requested ?? session.userId);
    if (id === undefined) throw badRequest('Indicá el empleado (userId)');
    return id;
  };

  return new Hono<AuthEnv>()
    .get('/visits', v('query', myVisitsQuery), async (c) => {
      const q = c.req.valid('query');
      return c.json(await myVisits(db, today(), actingUser(c.get('session'), q.userId), q.date ?? today()));
    })
    .post('/visits/:id/done', v('param', idParam), v('json', myDoneInput), v('query', myVisitsQuery), async (c) => {
      const userId = actingUser(c.get('session'), c.req.valid('query').userId);
      return c.json(await markMyVisitDone(db, today(), userId, c.req.valid('param').id, c.req.valid('json')));
    });
}
