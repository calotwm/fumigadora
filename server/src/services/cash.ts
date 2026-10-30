import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { CASH_KINDS, monthOf, monthRange, PAYMENT_METHODS, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { cashEntries, expenseCategories, users } from '../db/schema.js';
import { badRequest, notFound, zDate, zMonth, zOptText, zPositiveCents } from '../http.js';

export const cashInput = z.object({
  kind: z.enum(CASH_KINDS),
  date: zDate.optional(),
  amountCents: zPositiveCents,
  categoryId: z.number().int().positive().nullish(),
  description: zOptText(300),
  method: z.enum(PAYMENT_METHODS).default('cash'),
});
export const cashPatch = z.object({
  date: zDate.optional(),
  amountCents: zPositiveCents.optional(),
  categoryId: z.number().int().positive().nullish(),
  description: zOptText(300),
  method: z.enum(PAYMENT_METHODS).optional(),
});

export const cashListQuery = z.object({ month: zMonth.optional(), kind: z.enum(CASH_KINDS).optional() });

async function assertCategory(db: Db, id: number) {
  const [row] = await db.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, id));
  if (!row) throw badRequest('La categoría indicada no existe');
}

const select = {
  id: cashEntries.id,
  kind: cashEntries.kind,
  date: cashEntries.date,
  amountCents: cashEntries.amountCents,
  categoryId: cashEntries.categoryId,
  categoryName: expenseCategories.name,
  description: cashEntries.description,
  method: cashEntries.method,
  employeeId: cashEntries.employeeId,
  employeeName: users.name,
};

async function getEntry(db: Db, id: number) {
  const [row] = await db
    .select(select)
    .from(cashEntries)
    .leftJoin(expenseCategories, eq(expenseCategories.id, cashEntries.categoryId))
    .leftJoin(users, eq(users.id, cashEntries.employeeId))
    .where(eq(cashEntries.id, id));
  if (!row) throw notFound('Movimiento');
  return row;
}

export async function listCashEntries(db: Db, today: IsoDate, q: z.infer<typeof cashListQuery>) {
  const { from, to } = monthRange(q.month ?? monthOf(today));
  return db
    .select(select)
    .from(cashEntries)
    .leftJoin(expenseCategories, eq(expenseCategories.id, cashEntries.categoryId))
    .leftJoin(users, eq(users.id, cashEntries.employeeId))
    .where(and(gte(cashEntries.date, from), lte(cashEntries.date, to), q.kind ? eq(cashEntries.kind, q.kind) : undefined))
    .orderBy(desc(cashEntries.date), desc(cashEntries.id));
}

export async function createCashEntry(db: Db, today: IsoDate, input: z.infer<typeof cashInput>) {
  if (input.kind === 'expense') {
    if (!input.categoryId) throw badRequest('Elegí una categoría para el gasto');
    await assertCategory(db, input.categoryId);
  }
  const [row] = await db
    .insert(cashEntries)
    .values({
      kind: input.kind,
      date: input.date ?? today,
      amountCents: input.amountCents,
      categoryId: input.kind === 'expense' ? input.categoryId! : null,
      description: input.description ?? '',
      method: input.method,
    })
    .returning({ id: cashEntries.id });
  return getEntry(db, row!.id);
}

export async function updateCashEntry(db: Db, id: number, patch: z.infer<typeof cashPatch>) {
  const current = await getEntry(db, id);
  const values: Partial<typeof cashEntries.$inferInsert> = {};
  if (patch.date !== undefined) values.date = patch.date;
  if (patch.amountCents !== undefined) values.amountCents = patch.amountCents;
  if (patch.description !== undefined) values.description = patch.description ?? '';
  if (patch.method !== undefined) values.method = patch.method;
  if (patch.categoryId !== undefined && current.kind === 'expense') {
    if (!patch.categoryId) throw badRequest('Elegí una categoría para el gasto');
    await assertCategory(db, patch.categoryId);
    values.categoryId = patch.categoryId;
  }
  if (Object.keys(values).length > 0) await db.update(cashEntries).set(values).where(eq(cashEntries.id, id));
  return getEntry(db, id);
}

export async function deleteCashEntry(db: Db, id: number) {
  await getEntry(db, id);
  await db.delete(cashEntries).where(eq(cashEntries.id, id));
  return { ok: true as const };
}
