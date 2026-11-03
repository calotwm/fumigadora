import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { IsoDate } from '@fumigadora/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { clients, payments, users } from '../db/schema.js';
import { badRequest, zId } from '../http.js';

export const confirmInput = z.object({ paymentIds: z.array(zId).min(1, 'Elegí al menos un cobro').max(500) });

const RECENT_LIMIT = 30;

const baseSelect = {
  paymentId: payments.id,
  paidOn: payments.paidOn,
  amountCents: payments.amountCents,
  visitId: payments.visitId,
  clientId: payments.clientId,
  clientName: clients.name,
  userId: users.id,
  userName: users.name,
  handedOverAt: payments.handedOverAt,
};

function base(db: Db) {
  return db
    .select(baseSelect)
    .from(payments)
    .innerJoin(clients, eq(clients.id, payments.clientId))
    .innerJoin(users, eq(users.id, payments.collectedByUserId));
}

/** Cash collected by employees: pending per employee ("a rendir") and the most recent confirmed handovers. */
export async function cashHandover(db: Db) {
  const [pending, recent] = await Promise.all([
    base(db)
      .where(and(isNotNull(payments.collectedByUserId), isNull(payments.handedOverAt)))
      .orderBy(payments.paidOn, payments.id),
    base(db)
      .where(and(isNotNull(payments.handedOverAt), eq(payments.method, 'cash')))
      .orderBy(desc(payments.handedOverAt), desc(payments.id))
      .limit(RECENT_LIMIT),
  ]);

  const byUser = new Map<number, { userId: number; name: string; pendingCents: number; count: number; items: typeof pending }>();
  for (const row of pending) {
    const entry = byUser.get(row.userId) ?? { userId: row.userId, name: row.userName, pendingCents: 0, count: 0, items: [] };
    entry.pendingCents += row.amountCents;
    entry.count += 1;
    entry.items.push(row);
    byUser.set(row.userId, entry);
  }
  const employees = [...byUser.values()]
    .sort((a, b) => b.pendingCents - a.pendingCents)
    .map((e) => ({
      userId: e.userId,
      name: e.name,
      pendingCents: e.pendingCents,
      count: e.count,
      items: e.items.map((i) => ({
        paymentId: i.paymentId,
        date: i.paidOn,
        clientId: i.clientId,
        clientName: i.clientName,
        amountCents: i.amountCents,
        visitId: i.visitId,
      })),
    }));
  return {
    pendingCents: employees.reduce((s, e) => s + e.pendingCents, 0),
    pendingCount: pending.length,
    employees,
    recent: recent.map((r) => ({
      paymentId: r.paymentId,
      date: r.paidOn,
      clientId: r.clientId,
      clientName: r.clientName,
      amountCents: r.amountCents,
      visitId: r.visitId,
      userId: r.userId,
      userName: r.userName,
      handedOverAt: r.handedOverAt,
    })),
  };
}

/** Owner confirms receiving the cash. All-or-nothing: every id must be a pending employee collection. */
export async function confirmHandover(db: Db, input: z.infer<typeof confirmInput>) {
  const ids = [...new Set(input.paymentIds)];
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(inArray(payments.id, ids), isNotNull(payments.collectedByUserId), isNull(payments.handedOverAt)));
    if (pending.length !== ids.length) {
      throw badRequest('Algunos cobros no existen o ya fueron confirmados');
    }
    const now = new Date();
    await tx.update(payments).set({ handedOverAt: now }).where(inArray(payments.id, ids));
    return { confirmed: ids.length, handedOverAt: now };
  });
}

/** Totals for the dashboard alert. */
export async function cashPendingTotals(db: Db) {
  const rows = await db
    .select({ amountCents: payments.amountCents })
    .from(payments)
    .where(and(isNotNull(payments.collectedByUserId), isNull(payments.handedOverAt)));
  return { cents: rows.reduce((s, r) => s + r.amountCents, 0), count: rows.length };
}

/** Cash each employee collected between two dates (by `paidOn`), split into handed over and still pending. */
export async function cashCollectedByEmployee(db: Db, from: IsoDate, to: IsoDate) {
  const rows = await db
    .select({
      userId: payments.collectedByUserId,
      collectedCents: sql<number>`coalesce(sum(${payments.amountCents}), 0)`.mapWith(Number),
      handedOverCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.handedOverAt} is not null), 0)`.mapWith(Number),
    })
    .from(payments)
    .where(and(isNotNull(payments.collectedByUserId), eq(payments.method, 'cash'), gte(payments.paidOn, from), lte(payments.paidOn, to)))
    .groupBy(payments.collectedByUserId);
  return new Map(
    rows.map((r) => [r.userId!, { collectedCents: r.collectedCents, handedOverCents: r.handedOverCents, pendingCents: r.collectedCents - r.handedOverCents }]),
  );
}
