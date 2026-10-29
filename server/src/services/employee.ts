import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { badRequest, notFound, zDate, zOptText, zPositiveCents } from '../http.js';
import { clientFinancials } from './accounts.js';
import { extraLineInput } from './extras.js';
import { createPayment } from './payments.js';
import { completeVisit, getVisit, listVisits } from './visits.js';

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
