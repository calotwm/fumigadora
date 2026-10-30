import { and, count, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { addDays, type IsoDate, type PaymentMethod } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { cashEntries, clients, expenseCategories, invoices, notifications, payments, users, visits } from '../db/schema.js';
import { openInvoiceRows } from './accounts.js';
import { cashPendingTotals } from './handover.js';

export interface VisitCounts {
  done: number;
  pending: number;
  postponed: number;
  cancelled: number;
}

const UNASSIGNED = 'Sin asignar';
const OFFICE = 'Oficina';

const byNameNullLast = <T extends { userId: number | null; name: string }>(a: T, b: T) =>
  Number(a.userId === null) - Number(b.userId === null) || a.name.localeCompare(b.name, 'es');

/**
 * Postponements reported from the employee app on `day`, per employee. Visits keep no history of their old date, so
 * the source is the `visit_postponed` admin alerts (one row per admin, grouped bursts carry a count): the largest
 * count any admin received is the number of postponements. Reschedules made by the office are not counted.
 */
async function postponedByEmployee(db: Db, day: IsoDate): Promise<Map<number, number>> {
  const rows = await db
    .select({ groupKey: notifications.groupKey, total: sql<number>`sum(${notifications.groupCount})`.mapWith(Number) })
    .from(notifications)
    .where(and(eq(notifications.kind, 'visit_postponed'), like(notifications.dedupeKey, `%:${day}`)))
    .groupBy(notifications.userId, notifications.groupKey);
  const result = new Map<number, number>();
  for (const row of rows) {
    const employeeId = Number(row.groupKey?.split(':')[1]);
    if (!Number.isInteger(employeeId)) continue;
    result.set(employeeId, Math.max(result.get(employeeId) ?? 0, row.total));
  }
  return result;
}

async function visitSummary(db: Db, day: IsoDate) {
  const [rows, postponed] = await Promise.all([
    db
      .select({ userId: visits.assignedUserId, name: users.name, status: visits.status, n: count() })
      .from(visits)
      .leftJoin(users, eq(users.id, visits.assignedUserId))
      .where(eq(visits.date, day))
      .groupBy(visits.assignedUserId, users.name, visits.status),
    postponedByEmployee(db, day),
  ]);
  const byUser = new Map<number | null, { userId: number | null; name: string } & VisitCounts>();
  const entry = (userId: number | null, name: string | null) => {
    let e = byUser.get(userId);
    if (!e) {
      e = { userId, name: name ?? UNASSIGNED, done: 0, pending: 0, postponed: 0, cancelled: 0 };
      byUser.set(userId, e);
    }
    return e;
  };
  for (const r of rows) {
    const e = entry(r.userId, r.name);
    if (r.status === 'done') e.done += r.n;
    else if (r.status === 'cancelled') e.cancelled += r.n;
    else e.pending += r.n;
  }
  if (postponed.size > 0) {
    const names = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...postponed.keys()]));
    const nameOf = new Map(names.map((u) => [u.id, u.name]));
    for (const [userId, n] of postponed) entry(userId, nameOf.get(userId) ?? null).postponed += n;
  }
  const byEmployee = [...byUser.values()].sort(byNameNullLast);
  const totals: VisitCounts = { done: 0, pending: 0, postponed: 0, cancelled: 0 };
  for (const e of byEmployee) {
    totals.done += e.done;
    totals.pending += e.pending;
    totals.postponed += e.postponed;
    totals.cancelled += e.cancelled;
  }
  return { totals, byEmployee };
}

async function collectionSummary(db: Db, day: IsoDate) {
  const [rows, pending] = await Promise.all([
    db
      .select({
        amountCents: payments.amountCents,
        method: payments.method,
        userId: payments.collectedByUserId,
        name: users.name,
        handedOverAt: payments.handedOverAt,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.collectedByUserId))
      .where(eq(payments.paidOn, day)),
    cashPendingTotals(db),
  ]);
  const byMethod = new Map<PaymentMethod, { method: PaymentMethod; cents: number; count: number }>();
  const byUser = new Map<number | null, { userId: number | null; name: string; cents: number; count: number; cashCents: number; toHandOverCents: number }>();
  let dayCents = 0;
  let dayCount = 0;
  for (const p of rows) {
    const m = byMethod.get(p.method) ?? { method: p.method, cents: 0, count: 0 };
    m.cents += p.amountCents;
    m.count += 1;
    byMethod.set(p.method, m);

    const u = byUser.get(p.userId) ?? { userId: p.userId, name: p.name ?? OFFICE, cents: 0, count: 0, cashCents: 0, toHandOverCents: 0 };
    u.cents += p.amountCents;
    u.count += 1;
    if (p.method === 'cash') u.cashCents += p.amountCents;
    // Same rule as the cash handover: employee collections not yet confirmed by the owner.
    if (p.userId !== null && p.handedOverAt === null) {
      u.toHandOverCents += p.amountCents;
      dayCents += p.amountCents;
      dayCount += 1;
    }
    byUser.set(p.userId, u);
  }
  return {
    totalCents: rows.reduce((s, p) => s + p.amountCents, 0),
    count: rows.length,
    byMethod: [...byMethod.values()].sort((a, b) => b.cents - a.cents || a.method.localeCompare(b.method)),
    byEmployee: [...byUser.values()].sort((a, b) => b.cents - a.cents || byNameNullLast(a, b)),
    cashToHandOver: { dayCents, dayCount, totalCents: pending.cents, totalCount: pending.count },
  };
}

async function invoiceSummary(db: Db, day: IsoDate) {
  const items = await db
    .select({ id: invoices.id, number: invoices.number, clientId: invoices.clientId, clientName: clients.name, amountCents: invoices.amountCents })
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .where(and(eq(invoices.issuedOn, day), isNull(invoices.voidedAt)))
    .orderBy(invoices.id);
  return { count: items.length, totalCents: items.reduce((s, i) => s + i.amountCents, 0), items };
}

/**
 * Invoices that became overdue on `day` (an invoice is overdue the day after its due date) and still have an unpaid
 * balance. The balance is today's, so for a past date it reflects payments made since.
 */
async function newOverdueSummary(db: Db, day: IsoDate) {
  const dueOn = addDays(day, -1);
  const open = (await openInvoiceRows(db)).filter((i) => i.dueOn === dueOn && i.amountCents > i.paidCents);
  const clientIds = [...new Set(open.map((i) => i.clientId))];
  const names = clientIds.length
    ? new Map((await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds))).map((c) => [c.id, c.name]))
    : new Map<number, string>();
  const items = open.map((i) => ({
    invoiceId: i.id,
    number: i.number,
    clientId: i.clientId,
    clientName: names.get(i.clientId) ?? '',
    balanceCents: i.amountCents - i.paidCents,
    dueOn: i.dueOn,
  }));
  return { count: items.length, totalCents: items.reduce((s, i) => s + i.balanceCents, 0), items };
}

async function expenseSummary(db: Db, day: IsoDate) {
  const items = await db
    .select({
      id: cashEntries.id,
      amountCents: cashEntries.amountCents,
      categoryName: expenseCategories.name,
      description: cashEntries.description,
      method: cashEntries.method,
    })
    .from(cashEntries)
    .leftJoin(expenseCategories, eq(expenseCategories.id, cashEntries.categoryId))
    .where(and(eq(cashEntries.kind, 'expense'), eq(cashEntries.date, day)))
    .orderBy(desc(cashEntries.amountCents), cashEntries.id);
  return { count: items.length, totalCents: items.reduce((s, e) => s + e.amountCents, 0), items };
}

/** "Cierre del día": everything that happened on one business day, computed from existing records. */
export async function daySummary(db: Db, day: IsoDate) {
  const [visitsOfDay, collections, issued, newOverdue, expenses] = await Promise.all([
    visitSummary(db, day),
    collectionSummary(db, day),
    invoiceSummary(db, day),
    newOverdueSummary(db, day),
    expenseSummary(db, day),
  ]);
  return { date: day, visits: visitsOfDay, collections, invoices: issued, newOverdue, expenses };
}

export type DaySummary = Awaited<ReturnType<typeof daySummary>>;
