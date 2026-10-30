import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, groupRouteItems, monthOf, monthRange, noticeDueDate, planMonthRoute, type IsoDate, type IsoMonth } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, emailLog, routePlanItems, routePlans, serviceTypes, users, visits, type RoutePlan } from '../db/schema.js';
import { badRequest, conflict, hhmm, notFound, zDate, zId, zTime, type Deps } from '../http.js';
import { serviceNoticeEmail } from '../mail/templates.js';
import { sendLogged } from './mail.js';
import { getSettings } from './settings.js';
import { computeRows } from './tracking.js';
import { requireAssignee } from './users.js';

export const itemPatch = z.object({
  date: zDate.optional(),
  time: zTime.nullish(),
  assignedUserId: zId.nullish(),
});

export const itemInput = z.object({
  clientId: zId,
  date: zDate,
  time: zTime.nullish(),
  serviceTypeId: zId.optional(),
  assignedUserId: zId.nullish(),
});

export type NoticeState = 'no_email' | 'pending' | 'scheduled' | 'sent' | 'simulated' | 'failed';

async function findPlan(db: Db, month: IsoMonth): Promise<RoutePlan | undefined> {
  const [plan] = await db.select().from(routePlans).where(eq(routePlans.month, month));
  return plan;
}

async function loadItem(db: Db, id: number) {
  const [item] = await db.select().from(routePlanItems).where(eq(routePlanItems.id, id));
  if (!item) throw notFound('Ítem del recorrido');
  const [plan] = await db.select().from(routePlans).where(eq(routePlans.id, item.planId));
  return { item, plan: plan! };
}

function requireDraft(plan: RoutePlan) {
  if (plan.status !== 'draft') throw conflict('El recorrido ya fue aprobado y no se puede modificar', 'route_approved');
}

function assertInMonth(month: IsoMonth, date: IsoDate) {
  const { from, to } = monthRange(month);
  if (date < from || date > to) throw badRequest(`La fecha ${date} no está dentro del mes ${month}`);
}

/** Builds (or rebuilds, while still a draft) the proposed route of `month`. */
export async function generateRoute(db: Db, today: IsoDate, month: IsoMonth) {
  if (month < monthOf(today)) throw badRequest('No se puede generar el recorrido de un mes pasado');
  const existing = await findPlan(db, month);
  if (existing?.status === 'approved') throw conflict('El recorrido de ese mes ya fue aprobado', 'route_approved');

  const rows = await computeRows(db, today, month);
  const due = rows.filter((r) => r.pendingUnscheduled > 0);
  const planable = due.filter((r) => r.serviceTypeId !== null);
  const skipped = due.filter((r) => r.serviceTypeId === null).map((r) => ({ clientId: r.clientId, name: r.name, reason: 'Sin servicio habitual definido' }));

  const proposal = planMonthRoute(
    month,
    planable.map((r) => ({ clientId: r.clientId, name: r.name, zone: r.zone, needed: r.pendingUnscheduled, frequency: r.frequency })),
    month === monthOf(today) ? { earliest: addDays(today, 1) } : {},
  );
  const byClient = new Map(planable.map((r) => [r.clientId, r]));

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    let planId = existing?.id;
    if (planId === undefined) {
      const [created] = await tx.insert(routePlans).values({ month }).returning({ id: routePlans.id });
      planId = created!.id;
    } else {
      await tx.delete(routePlanItems).where(eq(routePlanItems.planId, planId));
    }
    if (proposal.length > 0) {
      await tx.insert(routePlanItems).values(
        proposal.map((p) => ({
          planId: planId!,
          clientId: p.clientId,
          date: p.date,
          serviceTypeId: byClient.get(p.clientId)!.serviceTypeId!,
          zone: p.zone,
        })),
      );
    }
  });
  return { ...(await getRoute(db, today, month)), skipped };
}

export async function getRoute(db: Db, today: IsoDate, month: IsoMonth) {
  const settings = await getSettings(db);
  const plan = await findPlan(db, month);
  const base = { month, noticeMode: settings.noticeMode, noticeDaysBefore: settings.noticeDaysBefore };
  if (!plan) {
    return { ...base, plan: null, totals: totalsOf([]), zones: [] };
  }
  const rows = await db
    .select({
      id: routePlanItems.id,
      clientId: routePlanItems.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
      address: clients.address,
      latitude: clients.latitude,
      longitude: clients.longitude,
      date: routePlanItems.date,
      time: routePlanItems.time,
      serviceTypeId: routePlanItems.serviceTypeId,
      serviceTypeName: serviceTypes.name,
      frequency: clients.serviceFrequency,
      assignedUserId: routePlanItems.assignedUserId,
      assigneeName: users.name,
      zone: routePlanItems.zone,
      visitId: routePlanItems.visitId,
      noticeDueOn: routePlanItems.noticeDueOn,
      noticeEmailLogId: routePlanItems.noticeEmailLogId,
      noticeStatus: emailLog.status,
    })
    .from(routePlanItems)
    .innerJoin(clients, eq(clients.id, routePlanItems.clientId))
    .innerJoin(serviceTypes, eq(serviceTypes.id, routePlanItems.serviceTypeId))
    .leftJoin(users, eq(users.id, routePlanItems.assignedUserId))
    .leftJoin(emailLog, eq(emailLog.id, routePlanItems.noticeEmailLogId))
    .where(eq(routePlanItems.planId, plan.id))
    .orderBy(asc(routePlanItems.date), asc(clients.name), asc(routePlanItems.id));

  const items = rows.map((r) => {
    const hasEmail = !!r.clientEmail?.trim();
    let state: NoticeState;
    if (!hasEmail) state = 'no_email';
    else if (r.noticeStatus) state = r.noticeStatus;
    else state = plan.status === 'approved' ? 'scheduled' : 'pending';
    return {
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName,
      hasEmail,
      email: hasEmail ? r.clientEmail : null,
      address: r.address,
      latitude: r.latitude,
      longitude: r.longitude,
      date: r.date,
      time: hhmm(r.time),
      serviceTypeId: r.serviceTypeId,
      serviceTypeName: r.serviceTypeName,
      frequency: r.frequency,
      assignedUserId: r.assignedUserId,
      assigneeName: r.assigneeName,
      zone: r.zone,
      visitId: r.visitId,
      notice: { state, dueOn: r.noticeDueOn, emailLogId: r.noticeEmailLogId },
    };
  });
  return {
    ...base,
    plan: { id: plan.id, month: plan.month, status: plan.status, approvedAt: plan.approvedAt, notifiedAt: plan.notifiedAt },
    totals: totalsOf(items),
    zones: groupRouteItems(items),
  };
}

function totalsOf(items: { clientId: number; hasEmail: boolean; notice: { state: NoticeState } }[]) {
  const clientsSet = new Set(items.map((i) => i.clientId));
  const withEmail = items.filter((i) => i.hasEmail);
  const count = (state: NoticeState) => items.filter((i) => i.notice.state === state).length;
  return {
    visits: items.length,
    clients: clientsSet.size,
    withEmail: new Set(withEmail.map((i) => i.clientId)).size,
    withoutEmail: new Set(items.filter((i) => !i.hasEmail).map((i) => i.clientId)).size,
    notices: withEmail.length,
    noticesSent: count('sent'),
    noticesSimulated: count('simulated'),
    noticesFailed: count('failed'),
    noticesScheduled: count('scheduled'),
  };
}

export async function updateItem(db: Db, today: IsoDate, id: number, patch: z.infer<typeof itemPatch>) {
  const { item, plan } = await loadItem(db, id);
  requireDraft(plan);
  if (patch.date !== undefined) assertInMonth(plan.month, patch.date);
  if (patch.assignedUserId) await requireAssignee(db, patch.assignedUserId);
  const values: Partial<typeof routePlanItems.$inferInsert> = {};
  if (patch.date !== undefined) values.date = patch.date;
  if (patch.time !== undefined) values.time = patch.time;
  if (patch.assignedUserId !== undefined) values.assignedUserId = patch.assignedUserId;
  if (Object.keys(values).length > 0) await db.update(routePlanItems).set(values).where(eq(routePlanItems.id, item.id));
  return getRoute(db, today, plan.month);
}

export async function removeItem(db: Db, today: IsoDate, id: number) {
  const { item, plan } = await loadItem(db, id);
  requireDraft(plan);
  await db.delete(routePlanItems).where(eq(routePlanItems.id, item.id));
  return getRoute(db, today, plan.month);
}

export async function addItem(db: Db, today: IsoDate, month: IsoMonth, input: z.infer<typeof itemInput>) {
  assertInMonth(month, input.date);
  const existing = await findPlan(db, month);
  if (existing) requireDraft(existing);
  const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) throw notFound('Cliente');
  if (client.archivedAt) throw badRequest(`${client.name} está archivado`);
  const serviceTypeId = input.serviceTypeId ?? client.defaultServiceTypeId;
  if (!serviceTypeId) throw badRequest(`${client.name} no tiene un servicio habitual: elija el servicio`);
  const [service] = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(eq(serviceTypes.id, serviceTypeId));
  if (!service) throw notFound('Tipo de servicio');
  if (input.assignedUserId) await requireAssignee(db, input.assignedUserId);
  let planId = existing?.id;
  if (planId === undefined) {
    const [created] = await db.insert(routePlans).values({ month }).returning({ id: routePlans.id });
    planId = created!.id;
  }
  await db.insert(routePlanItems).values({
    planId,
    clientId: client.id,
    date: input.date,
    time: input.time ?? null,
    serviceTypeId,
    assignedUserId: input.assignedUserId ?? null,
    zone: client.area?.trim() || null,
  });
  return getRoute(db, today, month);
}

/**
 * Approves the draft: creates one scheduled visit per item in a single transaction, then sends (or schedules)
 * the notices. Mail failures never undo the visits.
 */
export async function approveRoute(deps: Deps, month: IsoMonth) {
  const { db } = deps;
  const today = deps.today();
  const plan = await findPlan(db, month);
  if (!plan) throw notFound('Recorrido');
  requireDraft(plan);
  const items = await db.select().from(routePlanItems).where(eq(routePlanItems.planId, plan.id)).orderBy(asc(routePlanItems.date), asc(routePlanItems.id));
  if (items.length === 0) throw badRequest('El recorrido no tiene visitas para aprobar');

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, archivedAt: clients.archivedAt, frequency: clients.serviceFrequency })
    .from(clients)
    .where(inArray(clients.id, [...new Set(items.map((i) => i.clientId))]));
  const clientById = new Map(clientRows.map((c) => [c.id, c]));
  for (const item of items) {
    const client = clientById.get(item.clientId);
    if (!client || client.archivedAt) throw badRequest(`${client?.name ?? 'Un cliente'} está archivado: quítelo del recorrido`);
    assertInMonth(month, item.date);
  }
  for (const userId of new Set(items.map((i) => i.assignedUserId).filter((x): x is number => x != null))) {
    await requireAssignee(db, userId);
  }

  const settings = await getSettings(db);
  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    for (const item of items) {
      const [visit] = await tx
        .insert(visits)
        .values({
          clientId: item.clientId,
          serviceTypeId: item.serviceTypeId,
          date: item.date,
          time: item.time,
          frequency: clientById.get(item.clientId)!.frequency,
          assignedUserId: item.assignedUserId,
        })
        .returning({ id: visits.id });
      await tx
        .update(routePlanItems)
        .set({ visitId: visit!.id, noticeDueOn: noticeDueDate(settings.noticeMode, item.date, today, settings.noticeDaysBefore) })
        .where(eq(routePlanItems.id, item.id));
    }
    await tx.update(routePlans).set({ status: 'approved', approvedAt: new Date() }).where(eq(routePlans.id, plan.id));
  });

  const notices = await sendDueNotices(deps);
  return { ...(await getRoute(db, today, month)), notices };
}

export interface NoticeSummary {
  sent: number;
  simulated: number;
  failed: number;
}

/**
 * Sends every service notice that is due (due day reached, visit still scheduled and not past) and was not sent yet.
 * A notice that failed is retried on the next run. Uses the visit's current date, so a rescheduled visit is announced
 * with its new date; cancelled or done visits are skipped.
 */
export async function sendDueNotices(deps: Deps): Promise<NoticeSummary> {
  const { db, mail } = deps;
  const today = deps.today();
  const summary: NoticeSummary = { sent: 0, simulated: 0, failed: 0 };
  const pending = await db
    .select({
      itemId: routePlanItems.id,
      planId: routePlanItems.planId,
      clientId: clients.id,
      clientName: clients.name,
      email: clients.email,
      address: clients.address,
      month: routePlans.month,
      serviceName: serviceTypes.name,
      visitDate: visits.date,
      visitTime: visits.time,
      assigneeName: users.name,
    })
    .from(routePlanItems)
    .innerJoin(routePlans, eq(routePlans.id, routePlanItems.planId))
    .innerJoin(visits, eq(visits.id, routePlanItems.visitId))
    .innerJoin(clients, eq(clients.id, routePlanItems.clientId))
    .innerJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
    .leftJoin(users, eq(users.id, visits.assignedUserId))
    .leftJoin(emailLog, eq(emailLog.id, routePlanItems.noticeEmailLogId))
    .where(
      and(
        eq(routePlans.status, 'approved'),
        lte(routePlanItems.noticeDueOn, today),
        or(isNull(routePlanItems.noticeEmailLogId), eq(emailLog.status, 'failed')),
        eq(visits.status, 'scheduled'),
        // A visit that is already in the past is not announced.
        gte(visits.date, today),
      ),
    )
    .orderBy(asc(visits.date), asc(routePlanItems.id));

  const touchedPlans = new Set<number>();
  for (const row of pending) {
    const to = row.email?.trim().toLowerCase();
    if (!to) continue;
    const log = await sendLogged(db, mail, {
      kind: 'service_notice',
      clientId: row.clientId,
      to,
      email: serviceNoticeEmail({
        clientName: row.clientName,
        serviceName: row.serviceName,
        date: row.visitDate,
        time: row.visitTime,
        address: row.address,
        assigneeName: row.assigneeName,
      }),
      refType: 'route_plan',
      refId: row.month,
      today,
    });
    await db.update(routePlanItems).set({ noticeEmailLogId: log.id }).where(eq(routePlanItems.id, row.itemId));
    summary[log.status]++;
    touchedPlans.add(row.planId);
  }

  for (const planId of touchedPlans) {
    const left = await db
      .select({ id: routePlanItems.id })
      .from(routePlanItems)
      .innerJoin(clients, eq(clients.id, routePlanItems.clientId))
      .leftJoin(emailLog, eq(emailLog.id, routePlanItems.noticeEmailLogId))
      .where(
        and(
          eq(routePlanItems.planId, planId),
          isNotNull(clients.email),
          ne(clients.email, ''),
          or(isNull(routePlanItems.noticeEmailLogId), eq(emailLog.status, 'failed')),
        ),
      );
    if (left.length === 0) await db.update(routePlans).set({ notifiedAt: new Date() }).where(and(eq(routePlans.id, planId), isNull(routePlans.notifiedAt)));
  }
  return summary;
}
