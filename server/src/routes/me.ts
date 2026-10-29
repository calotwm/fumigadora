import { Hono } from 'hono';
import type { AuthEnv, Session } from '../auth.js';
import { queueAutoEmit } from '../arca/service.js';
import { badRequest, conflict, idParam, notFound, v, type Deps } from '../http.js';
import { pushEnabled, removeSubscription, saveSubscription, subscribeInput, unsubscribeInput } from '../services/push.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications.js';
import { alertVisitDone } from '../services/adminAlerts.js';
import { markMyVisitDone, myDoneInput, myVisits, myVisitsQuery } from '../services/employee.js';

/**
 * Employee-facing routes. An employee always acts as themselves; an admin user acts as themself too, and
 * may pass `?userId=` to act as an employee (testing). The emergency owner login has no user id, so it must pass it.
 */
export function meRoutes(deps: Deps) {
  const { db, today } = deps;
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
      const result = await markMyVisitDone(db, today(), userId, c.req.valid('param').id, c.req.valid('json'));
      if (result.invoice) queueAutoEmit(deps, [result.invoice.id]);
      // Admins hear about field work right away; what the owner or an admin does themselves is not an alert.
      const session = c.get('session');
      if (session.role === 'employee') {
        await alertVisitDone(deps, {
          employeeId: userId,
          employeeName: session.name,
          clientId: result.visit.clientId,
          visitId: result.visit.id,
          ...(c.req.valid('json').cashCollectedCents ? { cashCents: c.req.valid('json').cashCollectedCents! } : {}),
        });
      }
      return c.json(result);
    })
    // Notifications belong to the signed-in user. The emergency owner session has no user, hence nothing to list.
    .get('/notifications', async (c) => {
      const { userId } = c.get('session');
      return c.json(userId === undefined ? { unreadCount: 0, items: [] } : await listNotifications(db, userId));
    })
    .post('/notifications/read-all', async (c) => {
      const { userId } = c.get('session');
      return c.json(userId === undefined ? { ok: true, updated: 0 } : await markAllNotificationsRead(db, userId));
    })
    // Web Push devices of the signed-in user. Everything is inert while VAPID is not configured.
    .get('/push', (c) => {
      const enabled = pushEnabled(db);
      return c.json({ enabled, publicKey: enabled ? (deps.config.push.publicKey ?? null) : null });
    })
    .post('/push/subscribe', v('json', subscribeInput), async (c) => {
      const { userId } = c.get('session');
      if (!pushEnabled(db)) throw conflict('Las notificaciones push no están activadas en el servidor', 'push_disabled');
      if (userId === undefined) throw badRequest('El acceso de emergencia no recibe notificaciones');
      return c.json(await saveSubscription(db, userId, c.req.valid('json'), c.req.header('user-agent')), 201);
    })
    .post('/push/unsubscribe', v('json', unsubscribeInput), async (c) => {
      const { userId } = c.get('session');
      if (userId === undefined) return c.json({ ok: true });
      return c.json(await removeSubscription(db, userId, c.req.valid('json').endpoint));
    })
    .post('/notifications/:id/read', v('param', idParam), async (c) => {
      const { userId } = c.get('session');
      if (userId === undefined) throw notFound('Notificación');
      return c.json(await markNotificationRead(db, userId, c.req.valid('param').id));
    });
}
