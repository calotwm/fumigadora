import { and, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { EMPLOYEE_PAY_KINDS, PAYMENT_METHODS, monthRange, type EmployeePayKind, type IsoDate, type IsoMonth } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { cashEntries, users } from '../db/schema.js';
import { badRequest, notFound, zDate, zId, zOptText, zPositiveCents } from '../http.js';
import { ensureCategory } from './catalog.js';
import { cashCollectedByEmployee } from './handover.js';

/** Expense category payments to employees are filed under. */
export const PAY_CATEGORY = 'Sueldos';

export const employeePayInput = z.object({
  userId: zId,
  date: zDate.optional(),
  amountCents: zPositiveCents,
  kind: z.enum(EMPLOYEE_PAY_KINDS),
  note: zOptText(300),
  method: z.enum(PAYMENT_METHODS).default('cash'),
});

const select = {
  id: cashEntries.id,
  date: cashEntries.date,
  userId: cashEntries.employeeId,
  userName: users.name,
  amountCents: cashEntries.amountCents,
  kind: cashEntries.payKind,
  note: cashEntries.description,
  method: cashEntries.method,
};

function payments(db: Db) {
  return db.select(select).from(cashEntries).innerJoin(users, eq(users.id, cashEntries.employeeId));
}

async function getPay(db: Db, id: number) {
  const [row] = await payments(db).where(and(eq(cashEntries.id, id), isNotNull(cashEntries.payKind)));
  if (!row) throw notFound('Pago al empleado');
  return { ...row, note: row.note || null };
}

/**
 * A payment to an employee is a regular expense (category "Sueldos", created if missing) tagged with the employee and
 * the kind, so it counts in the finance totals like any other expense.
 */
export async function createEmployeePay(db: Db, today: IsoDate, input: z.infer<typeof employeePayInput>) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
  if (!user) throw badRequest('El empleado indicado no existe');
  const categoryId = await ensureCategory(db, [PAY_CATEGORY]);
  const [row] = await db
    .insert(cashEntries)
    .values({
      kind: 'expense',
      date: input.date ?? today,
      amountCents: input.amountCents,
      categoryId,
      description: input.note ?? '',
      method: input.method,
      employeeId: input.userId,
      payKind: input.kind,
    })
    .returning({ id: cashEntries.id });
  return getPay(db, row!.id);
}

export async function deleteEmployeePay(db: Db, id: number) {
  await getPay(db, id);
  await db.delete(cashEntries).where(eq(cashEntries.id, id));
  return { ok: true as const };
}

/**
 * Per employee, for one month: what they were paid (by kind) and the cash they collected in the field, split into
 * handed over and still pending ("a rendir"). Lists active employees plus anyone with pay or collections that month.
 */
export async function employeePayMonth(db: Db, month: IsoMonth) {
  const { from, to } = monthRange(month);
  const [list, collected, staff] = await Promise.all([
    payments(db)
      .where(and(isNotNull(cashEntries.payKind), gte(cashEntries.date, from), lte(cashEntries.date, to)))
      .orderBy(desc(cashEntries.date), desc(cashEntries.id)),
    cashCollectedByEmployee(db, from, to),
    db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).orderBy(users.name),
  ]);

  const paid = new Map<number, Record<EmployeePayKind, number>>();
  for (const p of list) {
    const byKind = paid.get(p.userId!) ?? { sueldo: 0, adelanto: 0, otro: 0 };
    byKind[p.kind!] += p.amountCents;
    paid.set(p.userId!, byKind);
  }
  const employees = staff
    .filter((u) => (u.role === 'employee' && u.active) || paid.has(u.id) || collected.has(u.id))
    .map((u) => {
      const byKind = paid.get(u.id) ?? { sueldo: 0, adelanto: 0, otro: 0 };
      const cash = collected.get(u.id) ?? { collectedCents: 0, handedOverCents: 0, pendingCents: 0 };
      return {
        userId: u.id,
        name: u.name,
        paidCents: byKind.sueldo + byKind.adelanto + byKind.otro,
        byKind,
        cashCollectedCents: cash.collectedCents,
        cashHandedOverCents: cash.handedOverCents,
        cashPendingCents: cash.pendingCents,
      };
    });
  return {
    month,
    totalPaidCents: employees.reduce((s, e) => s + e.paidCents, 0),
    employees,
    payments: list.map((p) => ({ ...p, note: p.note || null })),
  };
}
