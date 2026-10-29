import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { nextVisitDate, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { payments, visits } from '../db/schema.js';
import { badRequest, conflict, notFound, zDate, zOptText, zPositiveCents, zTime } from '../http.js';
import { clientFinancials } from './accounts.js';
import { extraLineInput } from './extras.js';
import { createPayment } from './payments.js';
import { completeVisit, getVisit, insertNextVisit, listVisits, updateVisit } from './visits.js';

export const myVisitsQuery = z.object({
  date: zDate.optional(),
  /** Admins only (testing): act as this user. Ignored for employees. */
  userId: z.coerce.number().int().positive().optional(),
});

export const PAYMENT_STATUSES = ['full', 'partial', 'none'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
/** Ways an employee can be paid in the field. */
export const FIELD_PAYMENT_METHODS = ['cash', 'transfer', 'mercadopago'] as const;

export const myDoneInput = z.object({
  /** Did the client pay at the visit: everything (this visit's invoice), part of it (`amountCents`) or nothing. */
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(FIELD_PAYMENT_METHODS).default('cash'),
  /** Amount received when `paymentStatus` is `partial`. */
  amountCents: zPositiveCents.optional(),
  /** Legacy shape: cash received, equivalent to `partial` + `cash`. */
  cashCollectedCents: zPositiveCents.optional(),
  extras: z.array(extraLineInput).max(30).optional(),
  notes: zOptText(2000),
});

const METHOD_NOTES: Record<(typeof FIELD_PAYMENT_METHODS)[number], string> = {
  cash: 'Efectivo cobrado por el empleado',
  transfer: 'Transferencia informada por el empleado',
  mercadopago: 'Mercado Pago informado por el empleado',
};

/** Cash this employee collected and the owner has not confirmed yet. */
export async function pendingCashFor(db: Db, userId: number) {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(payments)
    .where(and(eq(payments.collectedByUserId, userId), isNull(payments.handedOverAt)));
  return { cents: row?.cents ?? 0, count: row?.count ?? 0 };
}

/**
 * The employee's own visits for a day (cancelled ones are hidden), with the client's balance, everything paid at the
 * visit (`paidCents`) and the cash part of it (`cashCollectedCents`, the one that is "a rendir").
 */
export async function myVisits(db: Db, today: IsoDate, userId: number, date: IsoDate) {
  const rows = (await listVisits(db, { from: date, to: date, assignedUserId: userId })).filter(
    (v) => v.status !== 'cancelled',
  );
  const balances = rows.length === 0 ? new Map() : await clientFinancials(db, today);
  const collected =
    rows.length === 0
      ? []
      : await db
          .select({
            visitId: payments.visitId,
            cents: sql<number>`sum(${payments.amountCents})`.mapWith(Number),
            cashCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.method} = 'cash'), 0)`.mapWith(Number),
          })
          .from(payments)
          .where(and(inArray(payments.visitId, rows.map((r) => r.id)), isNotNull(payments.collectedByUserId)))
          .groupBy(payments.visitId);
  const paidByVisit = new Map(collected.map((c) => [c.visitId, c]));
  return {
    date,
    visits: rows.map((v) => ({
      ...v,
      clientBalanceCents: balances.get(v.clientId)?.balanceCents ?? 0,
      paidCents: paidByVisit.get(v.id)?.cents ?? 0,
      cashCollectedCents: paidByVisit.get(v.id)?.cashCents ?? 0,
    })),
    cashPending: await pendingCashFor(db, userId),
  };
}

/**
 * An employee closes one of their own scheduled visits: extras are billed on the invoice and the payment received
 * (if any) is registered and allocated to that invoice first, the remainder FIFO to older debt. All in one
 * transaction. Only cash is "a rendir"; transfers and Mercado Pago are recorded as already received.
 */
export async function markMyVisitDone(
  db: Db,
  today: IsoDate,
  userId: number,
  visitId: number,
  input: z.infer<typeof myDoneInput>,
) {
  const visit = await getVisit(db, visitId);
  // Same answer for "does not exist" and "belongs to someone else": do not leak other employees' agenda.
  if (visit.assignedUserId !== userId) throw notFound('Visita');

  const status: PaymentStatus | null = input.paymentStatus ?? (input.cashCollectedCents ? 'partial' : null);
  const method = input.cashCollectedCents && !input.paymentStatus ? 'cash' : input.method;
  const hasExtras = (input.extras?.length ?? 0) > 0;
  const ownPrice = (visit.priceCents ?? 0) > 0;
  if (status === 'full' && !ownPrice && !hasExtras) throw badRequest('Esta visita no tiene importe para cobrar');
  const partialCents = input.amountCents ?? input.cashCollectedCents;
  if (status === 'partial' && !partialCents) throw badRequest('Indicá el importe cobrado');

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    // Same defaults as the owner's completion sheet: invoice only when the visit has an agreed price (or extras),
    // follow-up per the visit's frequency; the service type decides the oblea.
    const result = await completeVisit(tx, today, visitId, {
      createInvoice: ownPrice || hasExtras,
      scheduleNext: visit.frequency !== 'none',
      // Without its own price the base service is not billed: only the extras are.
      ...(!ownPrice && hasExtras ? { priceCents: 0 } : {}),
      ...(hasExtras ? { extras: input.extras! } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    const amountCents = status === 'full' ? result.invoice!.amountCents : status === 'partial' ? partialCents! : 0;
    const payment =
      amountCents > 0
        ? await createPayment(
            tx,
            today,
            {
              clientId: visit.clientId,
              amountCents,
              method,
              notes: `${METHOD_NOTES[method]} (visita #${visitId})`,
              ...(result.invoice ? { invoiceId: result.invoice.id } : {}),
            },
            { userId, visitId, handedOver: method !== 'cash' },
          )
        : null;
    return { ...result, payment, paymentStatus: status, paymentMethod: payment ? method : null };
  });
}

export const myPostponeInput = z.object({
  date: zDate,
  /** New time; `null` clears it, omitted keeps the current one. */
  time: zTime.nullish(),
});

export const myCancelInput = z.object({
  reason: z.string().trim().min(1, 'Indicá el motivo de la cancelación').max(500),
});

/** One of the caller's own visits that can still be changed; unknown and foreign ids answer the same. */
async function ownScheduledVisit(db: Db, userId: number, visitId: number) {
  const visit = await getVisit(db, visitId);
  if (visit.assignedUserId !== userId) throw notFound('Visita');
  if (visit.status !== 'scheduled') throw conflict('La visita ya fue completada o cancelada');
  return visit;
}

/** The client asked for another day: the employee moves their own pending visit to a new date (and time). */
export async function postponeMyVisit(db: Db, today: IsoDate, userId: number, visitId: number, input: z.infer<typeof myPostponeInput>) {
  const visit = await ownScheduledVisit(db, userId, visitId);
  if (input.date < today) throw badRequest('La nueva fecha no puede ser anterior a hoy');
  const time = input.time === undefined ? visit.time : input.time ? input.time.slice(0, 5) : null;
  if (input.date === visit.date && time === visit.time) throw badRequest('Elegí otra fecha u hora para posponer la visita');
  const moved = await updateVisit(db, visitId, { date: input.date, time });
  return { visit: moved, previous: { date: visit.date, time: visit.time } };
}

/**
 * The client cancelled: the employee cancels their own pending visit with a reason. A recurring visit schedules its
 * next occurrence (same rule as completing it) so the client does not fall off the plan.
 */
export async function cancelMyVisit(db: Db, today: IsoDate, userId: number, visitId: number, input: z.infer<typeof myCancelInput>) {
  const visit = await ownScheduledVisit(db, userId, visitId);
  let nextDate = nextVisitDate(visit.date, visit.frequency);
  // A visit cancelled late must not schedule its follow-up in the past.
  if (nextDate && nextDate <= today) nextDate = nextVisitDate(today, visit.frequency);
  const nextVisitId = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    await tx.update(visits).set({ status: 'cancelled', cancelReason: input.reason }).where(eq(visits.id, visitId));
    return nextDate ? insertNextVisit(tx, visit, nextDate, visit.time) : null;
  });
  return {
    visit: await getVisit(db, visitId),
    nextVisit: nextVisitId ? await getVisit(db, nextVisitId) : null,
  };
}
