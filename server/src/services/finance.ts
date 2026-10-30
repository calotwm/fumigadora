import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { addMonthsToMonth, lastMonths, monthRange, type IsoMonth } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { cashEntries, clients, expenseCategories, payments, users } from '../db/schema.js';

export interface MonthFigures {
  month: IsoMonth;
  incomeCents: number;
  paymentsCents: number;
  otherIncomeCents: number;
  expensesCents: number;
  balanceCents: number;
}

/** Income/expense figures for several consecutive months using two grouped queries. */
export async function monthFigures(db: Db, months: IsoMonth[]): Promise<Map<IsoMonth, MonthFigures>> {
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const from = monthRange(first).from;
  const to = monthRange(last).to;

  const [paymentRows, cashRows] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${payments.paidOn}, 'YYYY-MM')`,
        total: sql<number>`coalesce(sum(${payments.amountCents}), 0)`.mapWith(Number),
      })
      .from(payments)
      .where(and(gte(payments.paidOn, from), lte(payments.paidOn, to)))
      .groupBy(sql`1`),
    db
      .select({
        month: sql<string>`to_char(${cashEntries.date}, 'YYYY-MM')`,
        kind: cashEntries.kind,
        total: sql<number>`coalesce(sum(${cashEntries.amountCents}), 0)`.mapWith(Number),
      })
      .from(cashEntries)
      .where(and(gte(cashEntries.date, from), lte(cashEntries.date, to)))
      .groupBy(sql`1`, cashEntries.kind),
  ]);

  const result = new Map<IsoMonth, MonthFigures>();
  for (const month of months) {
    result.set(month, { month, incomeCents: 0, paymentsCents: 0, otherIncomeCents: 0, expensesCents: 0, balanceCents: 0 });
  }
  for (const p of paymentRows) {
    const f = result.get(p.month);
    if (f) f.paymentsCents = p.total;
  }
  for (const c of cashRows) {
    const f = result.get(c.month);
    if (!f) continue;
    if (c.kind === 'income') f.otherIncomeCents = c.total;
    else f.expensesCents = c.total;
  }
  for (const f of result.values()) {
    f.incomeCents = f.paymentsCents + f.otherIncomeCents;
    f.balanceCents = f.incomeCents - f.expensesCents;
  }
  return result;
}

export async function financeSummary(db: Db, month: IsoMonth) {
  const previousMonth = addMonthsToMonth(month, -1);
  const seriesMonths = lastMonths(month, 6);
  const { from, to } = monthRange(month);
  const [figures, byCategory] = await Promise.all([
    monthFigures(db, seriesMonths),
    db
      .select({
        categoryId: cashEntries.categoryId,
        name: sql<string>`coalesce(${expenseCategories.name}, 'Sin categoría')`,
        totalCents: sql<number>`sum(${cashEntries.amountCents})`.mapWith(Number),
      })
      .from(cashEntries)
      .leftJoin(expenseCategories, eq(expenseCategories.id, cashEntries.categoryId))
      .where(and(eq(cashEntries.kind, 'expense'), gte(cashEntries.date, from), lte(cashEntries.date, to)))
      .groupBy(cashEntries.categoryId, expenseCategories.name)
      .orderBy(desc(sql`sum(${cashEntries.amountCents})`)),
  ]);
  const current = figures.get(month)!;
  const previous = figures.get(previousMonth)!;
  const { month: _m1, ...currentFigures } = current;
  const { month: _m2, ...previousFigures } = previous;
  return {
    month,
    ...currentFigures,
    byCategory: byCategory.map((c) => ({
      ...c,
      share: current.expensesCents > 0 ? Math.round((c.totalCents / current.expensesCents) * 1000) / 10 : 0,
    })),
    previous: { month: previousMonth, ...previousFigures },
    series: seriesMonths.map((m) => figures.get(m)!),
  };
}

/** Payments and manual cash entries of a month as one list, newest first. */
export async function financeMovements(db: Db, month: IsoMonth) {
  const { from, to } = monthRange(month);
  const [paymentRows, cashRows] = await Promise.all([
    db
      .select({
        id: payments.id,
        date: payments.paidOn,
        amountCents: payments.amountCents,
        method: payments.method,
        notes: payments.notes,
        clientId: payments.clientId,
        clientName: clients.name,
      })
      .from(payments)
      .innerJoin(clients, eq(clients.id, payments.clientId))
      .where(and(gte(payments.paidOn, from), lte(payments.paidOn, to))),
    db
      .select({
        id: cashEntries.id,
        kind: cashEntries.kind,
        date: cashEntries.date,
        amountCents: cashEntries.amountCents,
        method: cashEntries.method,
        description: cashEntries.description,
        categoryId: cashEntries.categoryId,
        categoryName: expenseCategories.name,
        employeeId: cashEntries.employeeId,
        employeeName: users.name,
        hasReceipt: sql<boolean>`${cashEntries.receiptKey} is not null`,
      })
      .from(cashEntries)
      .leftJoin(expenseCategories, eq(expenseCategories.id, cashEntries.categoryId))
      .leftJoin(users, eq(users.id, cashEntries.employeeId))
      .where(and(gte(cashEntries.date, from), lte(cashEntries.date, to))),
  ]);

  const movements = [
    ...paymentRows.map((p) => ({
      type: 'payment' as const,
      id: p.id,
      date: p.date,
      direction: 'in' as const,
      amountCents: p.amountCents,
      method: p.method,
      description: p.notes ?? '',
      clientId: p.clientId,
      clientName: p.clientName,
      categoryId: null as number | null,
      categoryName: null as string | null,
      employeeId: null as number | null,
      employeeName: null as string | null,
      hasReceipt: false,
    })),
    ...cashRows.map((c) => ({
      type: c.kind,
      id: c.id,
      date: c.date,
      direction: (c.kind === 'income' ? 'in' : 'out') as 'in' | 'out',
      amountCents: c.amountCents,
      method: c.method,
      description: c.description,
      clientId: null as number | null,
      clientName: null as string | null,
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      employeeId: c.employeeId,
      employeeName: c.employeeName,
      hasReceipt: c.hasReceipt,
    })),
  ];
  movements.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return { month, movements };
}
