import { and, eq, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { payments } from '../db/schema.js';
import { notFound, zDate, zOptText, zPositiveCents } from '../http.js';
import { clientFinancials } from './accounts.js';
import { createPayment } from './payments.js';
import { completeVisit, getVisit, listVisits } from './visits.js';

export const myVisitsQuery = z.object({
  date: zDate.optional(),
  /** Admins only (testing): act as this user. Ignored for employees. */
  userId: z.coerce.number().int().positive().optional(),
});

export const myDoneInput = z.object({
  cashCollectedCents: zPositiveCents.optional(),
  notes: zOptText(2000),
});

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

/** The employee's own visits for a day (cancelled ones are hidden), with the client's balance and cash collected. */
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
          })
          .from(payments)
          .where(and(inArray(payments.visitId, rows.map((r) => r.id)), isNotNull(payments.collectedByUserId)))
          .groupBy(payments.visitId);
  const cashByVisit = new Map(collected.map((c) => [c.visitId, c.cents]));
  return {
    date,
    visits: rows.map((v) => ({
      ...v,
      clientBalanceCents: balances.get(v.clientId)?.balanceCents ?? 0,
      cashCollectedCents: cashByVisit.get(v.id) ?? 0,
    })),
    cashPending: await pendingCashFor(db, userId),
  };
}

/**
 * An employee marks one of their own scheduled visits as done, optionally with the cash collected.
 * Visit completion and cash payment happen in one transaction.
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

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    // Same defaults as the owner's completion sheet: invoice only when the visit has an agreed price,
    // follow-up per the visit's frequency; the service type decides the oblea.
    const result = await completeVisit(tx, today, visitId, {
      createInvoice: (visit.priceCents ?? 0) > 0,
      scheduleNext: visit.frequency !== 'none',
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    const payment = input.cashCollectedCents
      ? await createPayment(
          tx,
          today,
          {
            clientId: visit.clientId,
            amountCents: input.cashCollectedCents,
            method: 'cash',
            notes: `Efectivo cobrado por el empleado (visita #${visitId})`,
          },
          { userId, visitId },
        )
      : null;
    return { ...result, payment };
  });
}
