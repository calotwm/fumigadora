import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addDays,
  endOfWeek,
  FREQUENCIES,
  nextVisitDate,
  VISIT_STATUSES,
  type IsoDate,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { certificates, clients, serviceTypes, users, visitExtras, visits } from '../db/schema.js';
import {
  badRequest,
  conflict,
  definedOnly,
  hhmm,
  notFound,
  zBool,
  zCents,
  zDate,
  zId,
  zOptText,
  zTime,
} from '../http.js';
import { toInvoiceView, withInvoiceItems } from './accounts.js';
import { requireClient } from './clients.js';
import { extraLineInput, resolveExtraLines } from './extras.js';
import { insertInvoice, type InvoiceItemArgs } from './invoices.js';
import { requireAssignee } from './users.js';

export const visitInput = z.object({
  clientId: zId,
  serviceTypeId: zId,
  date: zDate,
  time: zTime.nullish(),
  frequency: z.enum(FREQUENCIES).default('none'),
  notes: zOptText(2000),
  priceCents: zCents.nullish(),
  assignedUserId: zId.nullish(),
});
export const visitPatch = visitInput.partial();

export const visitListQuery = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  clientId: zId.optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  assignedUserId: zId.optional(),
});

export const completeInput = z.object({
  completedOn: zDate.optional(),
  priceCents: zCents.optional(),
  createInvoice: zBool.default(false),
  /** Defaults to what the service type does: a type that issues certificates always issues the oblea. */
  issueCertificate: zBool.optional(),
  certificateNumber: z.string().trim().min(1).max(40).optional(),
  scheduleNext: zBool.default(false),
  nextDate: zDate.optional(),
  nextTime: zTime.nullish(),
  notes: zOptText(2000),
  /** Add-ons billed on the invoice next to the base service. */
  extras: z.array(extraLineInput).max(30).optional(),
});

/** Validity of the oblea when the service type does not define one. */
export const DEFAULT_CERTIFICATE_VALIDITY_DAYS = 30;

const visitSelect = {
  id: visits.id,
  clientId: visits.clientId,
  serviceTypeId: visits.serviceTypeId,
  date: visits.date,
  time: visits.time,
  status: visits.status,
  frequency: visits.frequency,
  notes: visits.notes,
  completedAt: visits.completedAt,
  cancelReason: visits.cancelReason,
  priceCents: visits.priceCents,
  assignedUserId: visits.assignedUserId,
  assigneeName: users.name,
  clientName: clients.name,
  clientAddress: clients.address,
  clientPhone: clients.phone,
  clientLatitude: clients.latitude,
  clientLongitude: clients.longitude,
  serviceTypeName: serviceTypes.name,
  issuesCertificate: serviceTypes.issuesCertificate,
};

type VisitJoined = Awaited<ReturnType<typeof selectVisits>>[number];

function selectVisits(db: Db, where: ReturnType<typeof and>) {
  return db
    .select(visitSelect)
    .from(visits)
    .innerJoin(clients, eq(clients.id, visits.clientId))
    .innerJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
    .leftJoin(users, eq(users.id, visits.assignedUserId))
    .where(where)
    .orderBy(asc(visits.date), sql`${visits.time} asc nulls last`, asc(visits.id));
}

function visitView(v: VisitJoined) {
  return { ...v, time: hhmm(v.time) };
}

export async function listVisits(db: Db, q: z.infer<typeof visitListQuery>) {
  const rows = await selectVisits(
    db,
    and(
      q.from ? gte(visits.date, q.from) : undefined,
      q.to ? lte(visits.date, q.to) : undefined,
      q.clientId ? eq(visits.clientId, q.clientId) : undefined,
      q.status ? eq(visits.status, q.status) : undefined,
      q.assignedUserId ? eq(visits.assignedUserId, q.assignedUserId) : undefined,
    ),
  );
  return rows.map(visitView);
}

export async function getVisit(db: Db, id: number) {
  const [row] = await selectVisits(db, eq(visits.id, id));
  if (!row) throw notFound('Visita');
  return visitView(row);
}

async function requireServiceType(db: Db, id: number) {
  const [row] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, id));
  if (!row) throw notFound('Tipo de servicio');
  return row;
}

export async function createVisit(db: Db, input: z.infer<typeof visitInput>) {
  await requireClient(db, input.clientId);
  await requireServiceType(db, input.serviceTypeId);
  if (input.assignedUserId) await requireAssignee(db, input.assignedUserId);
  const [row] = await db
    .insert(visits)
    .values({
      ...input,
      time: input.time ?? null,
      notes: input.notes ?? null,
      priceCents: input.priceCents ?? null,
      assignedUserId: input.assignedUserId ?? null,
    })
    .returning({ id: visits.id });
  return getVisit(db, row!.id);
}

export async function updateVisit(db: Db, id: number, patch: z.infer<typeof visitPatch>) {
  const current = await getVisit(db, id);
  if (current.status !== 'scheduled' && patch.date !== undefined && patch.date !== current.date) {
    throw conflict('Solo se puede reprogramar una visita pendiente');
  }
  if (patch.clientId) await requireClient(db, patch.clientId);
  if (patch.serviceTypeId) await requireServiceType(db, patch.serviceTypeId);
  if (patch.assignedUserId && patch.assignedUserId !== current.assignedUserId) await requireAssignee(db, patch.assignedUserId);
  const values = definedOnly(patch);
  if (Object.keys(values).length > 0) await db.update(visits).set(values).where(eq(visits.id, id));
  return getVisit(db, id);
}

/** The follow-up of a recurring visit: same client, service, frequency, price and assignee. Call inside a transaction. */
export async function insertNextVisit(db: Db, visit: Pick<VisitJoined, 'clientId' | 'serviceTypeId' | 'frequency' | 'priceCents' | 'assignedUserId'>, date: IsoDate, time: string | null) {
  const [next] = await db
    .insert(visits)
    .values({
      clientId: visit.clientId,
      serviceTypeId: visit.serviceTypeId,
      date,
      time,
      frequency: visit.frequency,
      priceCents: visit.priceCents,
      assignedUserId: visit.assignedUserId,
    })
    .returning({ id: visits.id });
  return next!.id;
}

export async function cancelVisit(db: Db, id: number) {
  const current = await getVisit(db, id);
  if (current.status !== 'scheduled') throw conflict('Solo se puede cancelar una visita pendiente');
  await db.update(visits).set({ status: 'cancelled' }).where(eq(visits.id, id));
  return getVisit(db, id);
}

async function nextCertificateNumber(db: Db): Promise<string> {
  const [row] = await db
    .select({ max: sql<number | null>`max(cast(${certificates.number} as bigint))` })
    .from(certificates)
    .where(sql`${certificates.number} ~ '^[0-9]{1,15}$'`);
  return String(Number(row?.max ?? 0) + 1);
}

/**
 * Completes a visit in ONE transaction: marks it done and optionally creates the invoice (base service line plus one
 * line per extra), the certificate and the next visit. The base service includes disinfection and oblea when the
 * service type issues certificates.
 */
export async function completeVisit(db: Db, today: IsoDate, id: number, input: z.infer<typeof completeInput>) {
  const visit = await getVisit(db, id);
  if (visit.status !== 'scheduled') throw conflict('La visita ya fue completada o cancelada');
  const serviceType = await requireServiceType(db, visit.serviceTypeId);
  const completedOn = input.completedOn ?? today;
  const priceCents = input.priceCents ?? visit.priceCents ?? serviceType.defaultPriceCents;
  // Extras are priced on the service price even when the base line is not billed (an employee closing a visit
  // without an agreed price sends 0): the visit's own price, else the service type's.
  const extrasBaseCents = priceCents > 0 ? priceCents : (visit.priceCents ?? serviceType.defaultPriceCents);
  const extraLines = await resolveExtraLines(db, input.extras, extrasBaseCents);
  const extrasCents = extraLines.reduce((sum, l) => sum + l.amountCents, 0);
  const totalCents = Math.max(priceCents, 0) + extrasCents;
  const issueCertificate = input.issueCertificate ?? serviceType.issuesCertificate;

  if (extraLines.length > 0 && !input.createInvoice) {
    throw badRequest('Los extras se cobran en la factura: activá "Crear factura"');
  }
  if (input.createInvoice && totalCents <= 0) {
    throw badRequest('Indicá un precio mayor a cero para generar la factura');
  }
  if (input.issueCertificate && !serviceType.issuesCertificate) {
    throw badRequest('Este servicio no emite oblea');
  }
  let nextDate: IsoDate | null = null;
  if (input.scheduleNext) {
    nextDate = input.nextDate ?? nextVisitDate(completedOn, visit.frequency);
    if (!nextDate) throw badRequest('Indicá la fecha de la próxima visita (la visita no tiene frecuencia)');
    if (nextDate <= completedOn) throw badRequest('La próxima visita debe ser posterior a la fecha de realización');
  }

  const created = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx
      .update(visits)
      .set({
        status: 'done',
        date: completedOn,
        completedAt: new Date(),
        priceCents,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(eq(visits.id, id));

    const lines: InvoiceItemArgs[] = [];
    if (priceCents > 0) {
      lines.push({
        description: serviceType.issuesCertificate ? `${serviceType.name} (incluye desinfección y oblea)` : serviceType.name,
        quantity: 1,
        unitPriceCents: priceCents,
      });
    }
    for (const l of extraLines) lines.push({ description: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, extraId: l.extraId });
    const invoice = input.createInvoice
      ? await insertInvoice(tx, {
          clientId: visit.clientId,
          visitId: id,
          amountCents: totalCents,
          issuedOn: completedOn,
          description: serviceType.name,
          items: lines,
        })
      : null;
    if (extraLines.length > 0) {
      await tx.insert(visitExtras).values(
        extraLines.map((l) => ({ visitId: id, extraId: l.extraId, name: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
      );
    }

    let certificate: typeof certificates.$inferSelect | null = null;
    if (issueCertificate) {
      const [inserted] = await tx
        .insert(certificates)
        .values({
          clientId: visit.clientId,
          visitId: id,
          number: input.certificateNumber ?? (await nextCertificateNumber(tx)),
          issuedOn: completedOn,
          expiresOn: addDays(completedOn, serviceType.certificateValidityDays ?? DEFAULT_CERTIFICATE_VALIDITY_DAYS),
        })
        .returning();
      certificate = inserted ?? null;
    }

    const nextVisitId = nextDate ? await insertNextVisit(tx, visit, nextDate, input.nextTime === undefined ? visit.time : input.nextTime) : null;
    return { invoice, certificate, nextVisitId };
  });

  const [invoice] = created.invoice ? await withInvoiceItems(db, [toInvoiceView(created.invoice, today)]) : [];
  return {
    visit: await getVisit(db, id),
    invoice: invoice ?? null,
    extras: extraLines,
    certificate: created.certificate,
    nextVisit: created.nextVisitId ? await getVisit(db, created.nextVisitId) : null,
  };
}

/** Counts of scheduled visits: today, tomorrow, rest of this Mon-Sun week, and late ones. */
export async function agendaSummary(db: Db, today: IsoDate) {
  const tomorrow = addDays(today, 1);
  const weekEnd = endOfWeek(today);
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${visits.date} = ${today})`.mapWith(Number),
      tomorrow: sql<number>`count(*) filter (where ${visits.date} = ${tomorrow})`.mapWith(Number),
      thisWeek: sql<number>`count(*) filter (where ${visits.date} >= ${today} and ${visits.date} <= ${weekEnd})`.mapWith(Number),
      overdueScheduled: sql<number>`count(*) filter (where ${visits.date} < ${today})`.mapWith(Number),
    })
    .from(visits)
    .where(eq(visits.status, 'scheduled'));
  return { today: row?.today ?? 0, tomorrow: row?.tomorrow ?? 0, thisWeek: row?.thisWeek ?? 0, overdueScheduled: row?.overdueScheduled ?? 0 };
}
