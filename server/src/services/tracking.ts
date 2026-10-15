import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { monthlyTrackingStatus, monthOf, monthRange, type Frequency, type IsoDate, type IsoMonth } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, serviceTypes, visits } from '../db/schema.js';
import { badRequest, hhmm, notFound, zDate, zId, zMonth, zTime } from '../http.js';
import { getVisit } from './visits.js';

export const TRACKING_STATUSES = ['pending', 'scheduled', 'complete'] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const trackingQuery = z.object({
  month: zMonth.optional(),
  zone: z.string().trim().max(120).optional(),
  status: z.enum(TRACKING_STATUSES).optional(),
});

export const scheduleInput = z.object({
  month: zMonth,
  items: z
    .array(
      z.object({
        clientId: zId,
        date: zDate,
        time: zTime.nullish(),
        serviceTypeId: zId.optional(),
      }),
    )
    .min(1, 'Elegí al menos un cliente')
    .max(300),
});

export interface TrackingRow {
  clientId: number;
  name: string;
  zone: string | null;
  frequency: Frequency;
  serviceTypeId: number | null;
  serviceTypeName: string | null;
  expected: number;
  done: number;
  scheduled: number;
  pendingUnscheduled: number;
  status: TrackingStatus;
  lastDoneOn: IsoDate | null;
  daysSinceLast: number | null;
  nextScheduled: { id: number; date: IsoDate; time: string | null } | null;
}

export interface TrackingTotals {
  expected: number;
  done: number;
  scheduled: number;
  pendingUnscheduled: number;
  clientsTracked: number;
}

/** Every active client with a service plan, with its status for `month`. Rows not due this month are omitted. */
async function computeRows(db: Db, today: IsoDate, month: IsoMonth) {
  const planned = await db
    .select({
      id: clients.id,
      name: clients.name,
      area: clients.area,
      frequency: clients.serviceFrequency,
      serviceTypeId: clients.defaultServiceTypeId,
      serviceTypeName: serviceTypes.name,
    })
    .from(clients)
    .leftJoin(serviceTypes, eq(serviceTypes.id, clients.defaultServiceTypeId))
    .where(and(isNull(clients.archivedAt), ne(clients.serviceFrequency, 'none')))
    .orderBy(asc(clients.name));

  const visitRows =
    planned.length === 0
      ? []
      : await db
          .select({
            id: visits.id,
            clientId: visits.clientId,
            serviceTypeId: visits.serviceTypeId,
            status: visits.status,
            date: visits.date,
            time: visits.time,
          })
          .from(visits)
          .where(
            and(
              inArray(
                visits.clientId,
                planned.map((c) => c.id),
              ),
              ne(visits.status, 'cancelled'),
            ),
          )
          .orderBy(asc(visits.date), asc(visits.id));

  const byClient = new Map<number, typeof visitRows>();
  for (const v of visitRows) {
    const list = byClient.get(v.clientId) ?? [];
    list.push(v);
    byClient.set(v.clientId, list);
  }

  const all = planned.map((c) => {
    // A plan with a habitual service only counts visits of that service; without one, any service counts.
    const own = (byClient.get(c.id) ?? []).filter((v) => c.serviceTypeId === null || v.serviceTypeId === c.serviceTypeId);
    const status = monthlyTrackingStatus({
      frequency: c.frequency,
      month,
      today,
      doneDates: own.filter((v) => v.status === 'done').map((v) => v.date),
      scheduledDates: own.filter((v) => v.status === 'scheduled').map((v) => v.date),
    });
    const next = own.find((v) => v.status === 'scheduled' && v.date >= today);
    const row: TrackingRow = {
      clientId: c.id,
      name: c.name,
      zone: c.area,
      frequency: c.frequency,
      serviceTypeId: c.serviceTypeId,
      serviceTypeName: c.serviceTypeName,
      expected: status.expected,
      done: status.done,
      scheduled: status.scheduled,
      pendingUnscheduled: status.pendingUnscheduled,
      status: status.pendingUnscheduled > 0 ? 'pending' : status.pending > 0 ? 'scheduled' : 'complete',
      lastDoneOn: status.lastDoneOn,
      daysSinceLast: status.daysSinceLast,
      nextScheduled: next ? { id: next.id, date: next.date, time: hhmm(next.time) } : null,
    };
    return row;
  });
  return all;
}

function totalsOf(all: TrackingRow[]): TrackingTotals {
  const sum = (pick: (r: TrackingRow) => number) => all.reduce((acc, r) => acc + pick(r), 0);
  return {
    expected: sum((r) => r.expected),
    done: sum((r) => r.done),
    scheduled: sum((r) => r.scheduled),
    pendingUnscheduled: sum((r) => r.pendingUnscheduled),
    clientsTracked: all.length,
  };
}

const zoneKey = (zone: string | null) => zone ?? '';

/** Board for the Seguimiento view: totals, per-client rows and the list of zones for the filter. */
export async function trackingBoard(db: Db, today: IsoDate, q: z.infer<typeof trackingQuery>) {
  const month = q.month ?? monthOf(today);
  const all = await computeRows(db, today, month);
  const zones = [...new Set(all.map((r) => r.zone).filter((z): z is string => z !== null))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const inZone = q.zone ? all.filter((r) => zoneKey(r.zone) === q.zone) : all;
  const relevant = inZone.filter((r) => r.expected > 0);
  const rows = relevant
    .filter((r) => !q.status || r.status === q.status)
    .sort((a, b) => {
      if ((a.zone === null) !== (b.zone === null)) return a.zone === null ? 1 : -1;
      return zoneKey(a.zone).localeCompare(zoneKey(b.zone), 'es') || a.name.localeCompare(b.name, 'es');
    });
  return { month, zones, totals: { ...totalsOf(relevant), clientsTracked: inZone.length }, rows };
}

/** Compact numbers for the dashboard block. */
export async function trackingSummary(db: Db, today: IsoDate) {
  const month = monthOf(today);
  const all = await computeRows(db, today, month);
  return { month, ...totalsOf(all.filter((r) => r.expected > 0)), clientsTracked: all.length };
}

/** Creates one scheduled visit per item (frequency = the client's plan) in a single transaction. */
export async function scheduleTracking(db: Db, input: z.infer<typeof scheduleInput>) {
  const { from, to } = monthRange(input.month);
  const ids = [...new Set(input.items.map((i) => i.clientId))];
  const planRows = await db
    .select({
      id: clients.id,
      name: clients.name,
      archivedAt: clients.archivedAt,
      frequency: clients.serviceFrequency,
      serviceTypeId: clients.defaultServiceTypeId,
    })
    .from(clients)
    .where(inArray(clients.id, ids));
  const plans = new Map(planRows.map((c) => [c.id, c]));

  const values = input.items.map((item) => {
    const client = plans.get(item.clientId);
    if (!client) throw notFound('Cliente');
    if (client.archivedAt) throw badRequest(`${client.name} está archivado`);
    if (item.date < from || item.date > to) throw badRequest(`La fecha ${item.date} no está dentro del mes ${input.month}`);
    const serviceTypeId = item.serviceTypeId ?? client.serviceTypeId;
    if (!serviceTypeId) throw badRequest(`${client.name} no tiene un servicio habitual: elegí el servicio`);
    return {
      clientId: client.id,
      serviceTypeId,
      date: item.date,
      time: item.time ?? null,
      frequency: client.frequency,
    };
  });

  const typeIds = [...new Set(values.map((v) => v.serviceTypeId))];
  const found = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(inArray(serviceTypes.id, typeIds));
  if (found.length !== typeIds.length) throw notFound('Tipo de servicio');

  const createdIds = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const rows = await tx.insert(visits).values(values).returning({ id: visits.id });
    return rows.map((r) => r.id);
  });
  const created = await Promise.all(createdIds.map((id) => getVisit(db, id)));
  return { created };
}
