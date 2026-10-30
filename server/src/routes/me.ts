import { Hono } from 'hono';
import type { AuthEnv, Session } from '../auth.js';
import { queueAutoEmit } from '../arca/service.js';
import { badRequest, conflict, idParam, notFound, v, type Deps } from '../http.js';
import { pushEnabled, removeSubscription, saveSubscription, subscribeInput, unsubscribeInput } from '../services/push.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications.js';
import { alertVisitChanged, alertVisitDone } from '../services/adminAlerts.js';
import { listExtras } from '../services/extras.js';
import { createFuelLoad, fuelInput } from '../services/cash.js';
import { checkUpload, IMAGE_TYPES, parseFields, readForm, uploadLimit } from '../services/uploads.js';
import {
  cancelMyVisit,
  markMyVisitDone,
  myCancelInput,
  myDoneInput,
  myPostponeInput,
  myVisits,
  myVisitsQuery,
  postponeMyVisit,
} from '../services/employee.js';

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
    // Fuel load: multipart `amountCents`, `date?` and the ticket `photo`. Stored as a fuel expense of the caller.
    .post('/fuel', uploadLimit(), v('query', myVisitsQuery), async (c) => {
      const userId = actingUser(c.get('session'), c.req.valid('query').userId);
      const { fields, files } = await readForm(c);
      const input = parseFields(fuelInput, fields);
      const photo = await checkUpload(files.photo, IMAGE_TYPES, {
        missing: 'Adjuntá la foto del ticket',
        wrongType: 'La foto debe ser una imagen JPG, PNG, WEBP o HEIC',
      });
      return c.json(await createFuelLoad(db, deps.config.filesDir, today(), userId, input, photo), 201);
    })
    // Active extras the employee can add when closing a visit.
    .get('/extras', async (c) => c.json(await listExtras(db, true)))
    .post('/visits/:id/done', v('param', idParam), v('json', myDoneInput), v('query', myVisitsQuery), async (c) => {
      const userId = actingUser(c.get('session'), c.req.valid('query').userId);
      const result = await markMyVisitDone(db, today(), userId, c.req.valid('param').id, c.req.valid('json'));
      if (result.invoice) queueAutoEmit(deps, [result.invoice.id]);
      // Admins hear about field work right away; what the owner or an admin does themselves is not an alert.
      const session = c.get('session');
      if (session.role === 'employee') {
        const body = c.req.valid('json');
        const cashCents = result.paymentMethod === 'cash' ? (result.payment?.payment.amountCents ?? 0) : 0;
        await alertVisitDone(deps, {
          employeeId: userId,
          employeeName: session.name,
          clientId: result.visit.clientId,
          visitId: result.visit.id,
          ...(body.paymentStatus
            ? {
                payment: {
                  status: body.paymentStatus,
                  method: body.method,
                  amountCents: result.payment?.payment.amountCents ?? 0,
                },
              }
            : {}),
          ...(cashCents > 0 ? { cashCents } : {}),
          extras: result.extras,
        });
      }
      return c.json(result);
    })
    // The client asked for another day.
    .post('/visits/:id/postpone', v('param', idParam), v('json', myPostponeInput), v('query', myVisitsQuery), async (c) => {
      const userId = actingUser(c.get('session'), c.req.valid('query').userId);
      const result = await postponeMyVisit(db, today(), userId, c.req.valid('param').id, c.req.valid('json'));
      const session = c.get('session');
      if (session.role === 'employee') {
        const { date, time } = result.visit;
        await alertVisitChanged(deps, {
          kind: 'visit_postponed',
          employeeId: userId,
          employeeName: session.name,
          clientId: result.visit.clientId,
          visitId: result.visit.id,
          detail: `al ${date.slice(8, 10)}/${date.slice(5, 7)}${time ? ` a las ${time}` : ''}`,
        });
      }
      return c.json(result);
    })
    // The client cancelled; the reason is required.
    .post('/visits/:id/cancel', v('param', idParam), v('json', myCancelInput), v('query', myVisitsQuery), async (c) => {
      const userId = actingUser(c.get('session'), c.req.valid('query').userId);
      const body = c.req.valid('json');
      const result = await cancelMyVisit(db, today(), userId, c.req.valid('param').id, body);
      const session = c.get('session');
      if (session.role === 'employee') {
        await alertVisitChanged(deps, {
          kind: 'visit_cancelled',
          employeeId: userId,
          employeeName: session.name,
          clientId: result.visit.clientId,
          visitId: result.visit.id,
          detail: body.reason,
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
