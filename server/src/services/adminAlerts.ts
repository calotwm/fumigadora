import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { formatMoney } from '@fumigadora/shared';
import { clients, notifications, users } from '../db/schema.js';
import type { Deps } from '../http.js';
import { createNotification, pushNotification } from './notifications.js';

/** Alerts of the same employee and kind inside this window (while unread) are merged into one notification. */
export const ALERT_GROUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Something an employee did that the admins should hear about right away.
 * Hook for new alert kinds (e.g. F6 extras): add the kind to `NOTIFICATION_KINDS` and AlertKind, a case in
 * `alertCopy`, and call `alertAdmins` from the employee flow.
 */
export type AlertKind = 'visit_done' | 'cash_collected';

export interface EmployeeAlert {
  kind: AlertKind;
  employeeId: number;
  employeeName: string;
  clientId: number;
  clientName: string;
  /** Money involved (cash alerts). Summed when alerts are grouped. */
  amountCents?: number;
  /** Id of the visit (or other record) behind the alert; makes a retried request idempotent. */
  entityId: number;
}

/** Spanish title, body and in-app link for an alert (or a group of `count` of them). */
export function alertCopy(alert: EmployeeAlert, count: number, totalCents: number | null) {
  const who = alert.employeeName;
  const single = { link: `/clientes/${alert.clientId}` };
  switch (alert.kind) {
    case 'visit_done':
      return count === 1
        ? { title: 'Visita completada', body: `${who} completó la visita de ${alert.clientName}.`, ...single }
        : { title: 'Visitas completadas', body: `${who} completó ${count} visitas.`, link: '/agenda' };
    case 'cash_collected':
      return count === 1
        ? { title: 'Cobro en efectivo', body: `${who} cobró ${formatMoney(totalCents ?? 0)} en efectivo de ${alert.clientName}.`, ...single }
        : { title: 'Cobros en efectivo', body: `${who} registró ${count} cobros en efectivo por ${formatMoney(totalCents ?? 0)}.`, link: '/finanzas' };
  }
}

/**
 * Notifies every active admin user (bell and push, no email). A burst from the same employee is grouped: if an admin
 * still has an unread alert of this employee and kind from the last `alertWindowMs`, it is updated ("Juan completó 3
 * visitas"), bumped to the top and pushed again with the same tag so phones replace it instead of stacking.
 */
export async function alertAdmins(deps: Deps, alert: EmployeeAlert) {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - (deps.alertWindowMs ?? ALERT_GROUP_WINDOW_MS));
  const groupKey = `${alert.kind}:${alert.employeeId}`;
  const tag = `alert:${groupKey}`;
  const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true)));
  let created = 0;
  let grouped = 0;
  for (const admin of admins) {
    const [open] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, admin.id), eq(notifications.groupKey, groupKey), isNull(notifications.readAt), gte(notifications.createdAt, since)))
      .orderBy(desc(notifications.id))
      .limit(1);
    if (open) {
      const count = open.groupCount + 1;
      const total = alert.amountCents === undefined ? open.groupAmountCents : (open.groupAmountCents ?? 0) + alert.amountCents;
      const copy = alertCopy(alert, count, total);
      const [row] = await db
        .update(notifications)
        .set({ groupCount: count, groupAmountCents: total, ...copy, createdAt: now })
        .where(eq(notifications.id, open.id))
        .returning();
      await pushNotification(db, row!, tag);
      grouped += 1;
      continue;
    }
    const copy = alertCopy(alert, 1, alert.amountCents ?? null);
    const row = await createNotification(db, {
      userId: admin.id,
      kind: alert.kind,
      ...copy,
      refType: 'employee_alert',
      refId: `${groupKey}:${alert.entityId}`,
      day: deps.today(),
      createdAt: now,
      pushTag: tag,
      groupKey,
      groupAmountCents: alert.amountCents ?? null,
    });
    if (row) created += 1;
  }
  return { created, grouped };
}

/** Alert for an employee that just completed a visit, optionally with cash collected there. Never throws. */
export async function alertVisitDone(deps: Deps, input: { employeeId: number; employeeName: string; clientId: number; visitId: number; cashCents?: number }) {
  try {
    const [client] = await deps.db.select({ name: clients.name }).from(clients).where(eq(clients.id, input.clientId));
    const base = { employeeId: input.employeeId, employeeName: input.employeeName, clientId: input.clientId, clientName: client?.name ?? 'un cliente', entityId: input.visitId };
    await alertAdmins(deps, { ...base, kind: 'visit_done' });
    if (input.cashCents) await alertAdmins(deps, { ...base, kind: 'cash_collected', amountCents: input.cashCents });
  } catch (error) {
    console.error('[alerts] could not alert the admins', error);
  }
}
