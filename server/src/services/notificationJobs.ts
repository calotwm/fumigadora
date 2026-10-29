import { and, count, eq, lt, min, sql } from 'drizzle-orm';
import { formatMoney } from '@fumigadora/shared';
import { payments, users, visits } from '../db/schema.js';
import { hhmm, type Deps } from '../http.js';
import { notifyAdmins } from './adminNotifications.js';
import { cashHandover } from './handover.js';
import { createNotification } from './notifications.js';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Active users with visits still `scheduled` today, with how many and the earliest time. */
async function usersWithOpenVisitsToday(deps: Deps) {
  return deps.db
    .select({ userId: users.id, total: count(), firstTime: min(visits.time) })
    .from(visits)
    .innerJoin(users, eq(users.id, visits.assignedUserId))
    .where(and(eq(visits.date, deps.today()), eq(visits.status, 'scheduled'), eq(users.active, true)))
    .groupBy(users.id);
}

/** Morning: each assignee gets their visits of the day; admins hear about visits from earlier days left `scheduled`. */
export async function runMorningNotifications(deps: Deps) {
  const day = deps.today();
  let visitsToday = 0;
  for (const row of await usersWithOpenVisitsToday(deps)) {
    const first = hhmm(row.firstTime);
    const created = await createNotification(deps.db, {
      userId: row.userId,
      kind: 'visits_today',
      title: 'Tus visitas de hoy',
      body: `Tenés ${plural(row.total, 'visita', 'visitas')} para hoy${first ? `, la primera a las ${first} hs` : ''}.`,
      link: '/app',
      day,
    });
    if (created) visitsToday += 1;
  }

  const [overdue] = await deps.db
    .select({ n: count() })
    .from(visits)
    .where(and(eq(visits.status, 'scheduled'), lt(visits.date, day)));
  const overdueCount = overdue?.n ?? 0;
  const admins =
    overdueCount > 0
      ? await notifyAdmins(deps.db, deps.mail, {
          kind: 'visits_overdue',
          title: 'Visitas de días anteriores sin cerrar',
          body: `Hay ${plural(overdueCount, 'visita', 'visitas')} de días anteriores que siguen programadas. Marcalas como hechas o reprogramalas.`,
          link: '/agenda',
          day,
        })
      : { created: 0, emailed: 0 };
  return { visitsToday, overdue: overdueCount, admins };
}

/** Afternoon: employees who still have visits not marked today get a nudge. */
export async function runAfternoonNotifications(deps: Deps) {
  const day = deps.today();
  let reminders = 0;
  for (const row of await usersWithOpenVisitsToday(deps)) {
    const created = await createNotification(deps.db, {
      userId: row.userId,
      kind: 'visits_reminder',
      title: 'Visitas sin marcar',
      body: `Todavía tenés ${plural(row.total, 'visita', 'visitas')} de hoy sin marcar.`,
      link: '/app',
      day,
    });
    if (created) reminders += 1;
  }
  return { reminders };
}

/** End of day: visits done/pending, money collected today and cash employees still have to hand over. */
export async function runEveningNotifications(deps: Deps) {
  const day = deps.today();
  const visitRows = await deps.db
    .select({ status: visits.status, n: count() })
    .from(visits)
    .where(eq(visits.date, day))
    .groupBy(visits.status);
  const done = visitRows.find((r) => r.status === 'done')?.n ?? 0;
  const pending = visitRows.find((r) => r.status === 'scheduled')?.n ?? 0;
  const [collected] = await deps.db
    .select({ cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::float8` })
    .from(payments)
    .where(eq(payments.paidOn, day));
  const collectedCents = collected?.cents ?? 0;
  const handover = await cashHandover(deps.db);

  // A day with nothing to report is not worth a notice.
  if (done + pending === 0 && collectedCents === 0 && handover.pendingCount === 0) return { sent: false as const };

  const lines = [
    `Visitas de hoy: ${plural(done, 'hecha', 'hechas')} y ${plural(pending, 'pendiente', 'pendientes')}.`,
    `Cobrado hoy: ${formatMoney(collectedCents)}.`,
    handover.pendingCount > 0
      ? `Efectivo a rendir por los empleados: ${formatMoney(handover.pendingCents)} (${plural(handover.pendingCount, 'cobro', 'cobros')}).`
      : 'No hay efectivo pendiente de rendir.',
  ];
  const admins = await notifyAdmins(deps.db, deps.mail, {
    kind: 'day_summary',
    title: 'Resumen del día',
    body: lines.join('\n'),
    link: '/',
    day,
  });
  return { sent: true as const, done, pending, collectedCents, cashToHandOverCents: handover.pendingCents, admins };
}
