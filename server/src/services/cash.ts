import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CASH_KINDS, monthOf, monthRange, PAYMENT_METHODS, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { cashEntries, expenseCategories, users } from '../db/schema.js';
import { badRequest, notFound, zDate, zMonth, zOptText, zPositiveCents } from '../http.js';
import { ensureCategory } from './catalog.js';
import { deleteStoredFile, writeStoredFile } from './files.js';
import type { Upload } from './uploads.js';

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
  hasReceipt: sql<boolean>`${cashEntries.receiptKey} is not null`,
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

export async function deleteCashEntry(db: Db, id: number, filesDir: string) {
  await getEntry(db, id);
  const [row] = await db.delete(cashEntries).where(eq(cashEntries.id, id)).returning({ receiptKey: cashEntries.receiptKey });
  if (row?.receiptKey) await deleteStoredFile(filesDir, row.receiptKey);
  return { ok: true as const };
}

// ---------- fuel loads from the employee app ----------

/** Category fuel loads are filed under; an existing "Nafta" one is reused. */
export const FUEL_CATEGORIES: [string, ...string[]] = ['Combustible', 'Nafta'];

export const fuelInput = z.object({
  amountCents: z.coerce.number().int().positive('El monto debe ser mayor a cero').max(1e13),
  date: zDate.optional(),
});

/**
 * An employee loaded fuel: a cash expense in the fuel category linked to them, with the ticket photo stored under
 * `receipts/<entry id>.<ext>`. Answers only what was loaded (no balances).
 */
export async function createFuelLoad(
  db: Db,
  filesDir: string,
  today: IsoDate,
  userId: number,
  input: z.infer<typeof fuelInput>,
  photo: Upload,
) {
  const categoryId = await ensureCategory(db, FUEL_CATEGORIES);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cashEntries)
      .values({
        kind: 'expense',
        date: input.date ?? today,
        amountCents: input.amountCents,
        categoryId,
        description: 'Carga de combustible',
        method: 'cash',
        employeeId: userId,
        receiptType: photo.type,
      })
      .returning({ id: cashEntries.id, date: cashEntries.date, amountCents: cashEntries.amountCents });
    const key = `receipts/${row!.id}.${photo.ext}`;
    // Written inside the transaction: a failed write leaves no entry behind.
    await writeStoredFile(filesDir, key, photo.bytes);
    await tx.update(cashEntries).set({ receiptKey: key }).where(eq(cashEntries.id, row!.id));
    return row!;
  });
}

/** Stored receipt photo of a cash entry, or null when it has none. */
export async function cashReceiptInfo(db: Db, id: number) {
  const [row] = await db
    .select({ key: cashEntries.receiptKey, type: cashEntries.receiptType, date: cashEntries.date })
    .from(cashEntries)
    .where(eq(cashEntries.id, id));
  return row?.key && row.type ? { key: row.key, type: row.type, date: row.date } : null;
}
