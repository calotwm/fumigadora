import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  PRODUCT_UNITS,
  STOCK_MOVEMENT_KINDS,
  fromMilli,
  hasMilliPrecision,
  monthOf,
  monthRange,
  toMilli,
  type IsoDate,
  type IsoMonth,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, products, stockMovements, users, visits } from '../db/schema.js';
import { badRequest, notFound, zBool, zDate, zId, zMonth, zOptText } from '../http.js';

/** A positive quantity with at most three decimals. */
const zQuantity = z
  .number()
  .positive('La cantidad debe ser mayor a cero')
  .max(1e9)
  .refine(hasMilliPrecision, 'Usá como máximo tres decimales');

export const productInput = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  unit: z.enum(PRODUCT_UNITS),
  minQuantity: z.number().min(0, 'El mínimo no puede ser negativo').max(1e9).refine(hasMilliPrecision, 'Usá como máximo tres decimales').nullish(),
});
export const productPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unit: z.enum(PRODUCT_UNITS).optional(),
  minQuantity: z.number().min(0).max(1e9).refine(hasMilliPrecision, 'Usá como máximo tres decimales').nullish(),
  active: zBool.optional(),
});

export const movementInput = z
  .object({
    productId: zId,
    kind: z.enum(STOCK_MOVEMENT_KINDS),
    /** Purchase and use: positive amount. Adjustment: signed correction (negative takes stock out). */
    quantity: z.number().max(1e9).min(-1e9).refine(hasMilliPrecision, 'Usá como máximo tres decimales'),
    date: zDate.optional(),
    visitId: zId.nullish(),
    userId: zId.nullish(),
    note: zOptText(300),
  })
  .refine((m) => (m.kind === 'adjustment' ? toMilli(m.quantity) !== 0 : toMilli(m.quantity) > 0), {
    message: 'La cantidad debe ser mayor a cero (el ajuste puede ser negativo, pero no cero)',
    path: ['quantity'],
  });

export const movementListQuery = z.object({ month: zMonth.optional(), productId: zId.optional() });

/** Product used at a visit, as the employee reports it when closing it. */
export const productUseInput = z.object({ productId: zId, quantity: zQuantity });

const stockSum = sql<number>`coalesce(sum(${stockMovements.quantityMilli}), 0)`.mapWith(Number);

/** Every product with its current stock (sum of movements) and the low-stock mark. Active first, then by name. */
export async function listProducts(db: Db) {
  const [rows, sums] = await Promise.all([
    db.select().from(products).orderBy(desc(products.active), asc(products.name)),
    db.select({ productId: stockMovements.productId, milli: stockSum }).from(stockMovements).groupBy(stockMovements.productId),
  ]);
  const stock = new Map(sums.map((s) => [s.productId, s.milli]));
  return rows.map((p) => shapeProduct(p, stock.get(p.id) ?? 0));
}

function shapeProduct(p: typeof products.$inferSelect, stockMilli: number) {
  return {
    id: p.id,
    name: p.name,
    unit: p.unit,
    minQuantity: p.minQuantityMilli === null ? null : fromMilli(p.minQuantityMilli),
    active: p.active,
    stock: fromMilli(stockMilli),
    belowMin: p.minQuantityMilli !== null && stockMilli < p.minQuantityMilli,
  };
}

async function getProduct(db: Db, id: number) {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw notFound('Producto');
  const [sum] = await db.select({ milli: stockSum }).from(stockMovements).where(eq(stockMovements.productId, id));
  return shapeProduct(row, sum?.milli ?? 0);
}

export async function createProduct(db: Db, input: z.infer<typeof productInput>) {
  const [row] = await db
    .insert(products)
    .values({ name: input.name, unit: input.unit, minQuantityMilli: input.minQuantity == null ? null : toMilli(input.minQuantity) })
    .returning({ id: products.id });
  return getProduct(db, row!.id);
}

export async function updateProduct(db: Db, id: number, patch: z.infer<typeof productPatch>) {
  await getProduct(db, id);
  const values: Partial<typeof products.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.unit !== undefined) values.unit = patch.unit;
  if (patch.active !== undefined) values.active = patch.active;
  if (patch.minQuantity !== undefined) values.minQuantityMilli = patch.minQuantity === null ? null : toMilli(patch.minQuantity);
  if (Object.keys(values).length > 0) await db.update(products).set(values).where(eq(products.id, id));
  return getProduct(db, id);
}

/** What an employee needs to pick a product when closing a visit: no stock figures. */
export function activeProductsForPicking(db: Db) {
  return db
    .select({ id: products.id, name: products.name, unit: products.unit })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));
}

const movementSelect = {
  id: stockMovements.id,
  productId: stockMovements.productId,
  productName: products.name,
  unit: products.unit,
  kind: stockMovements.kind,
  date: stockMovements.date,
  quantityMilli: stockMovements.quantityMilli,
  visitId: stockMovements.visitId,
  clientName: clients.name,
  userId: stockMovements.userId,
  userName: users.name,
  note: stockMovements.note,
};

function movementQuery(db: Db) {
  return db
    .select(movementSelect)
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(visits, eq(visits.id, stockMovements.visitId))
    .leftJoin(clients, eq(clients.id, visits.clientId))
    .leftJoin(users, eq(users.id, stockMovements.userId));
}

function shapeMovement<T extends { quantityMilli: number }>({ quantityMilli, ...m }: T) {
  return { ...m, quantity: fromMilli(quantityMilli) };
}

export async function listMovements(db: Db, today: IsoDate, q: z.infer<typeof movementListQuery>) {
  const { from, to } = monthRange(q.month ?? monthOf(today));
  const rows = await movementQuery(db)
    .where(and(gte(stockMovements.date, from), lte(stockMovements.date, to), q.productId ? eq(stockMovements.productId, q.productId) : undefined))
    .orderBy(desc(stockMovements.date), desc(stockMovements.id));
  return rows.map(shapeMovement);
}

async function getMovement(db: Db, id: number) {
  const [row] = await movementQuery(db).where(eq(stockMovements.id, id));
  if (!row) throw notFound('Movimiento de stock');
  return shapeMovement(row);
}

export async function createMovement(db: Db, today: IsoDate, input: z.infer<typeof movementInput>) {
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
  if (!product) throw badRequest('El producto indicado no existe');
  if (input.visitId) {
    const [visit] = await db.select({ id: visits.id }).from(visits).where(eq(visits.id, input.visitId));
    if (!visit) throw badRequest('La visita indicada no existe');
  }
  if (input.userId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
    if (!user) throw badRequest('El empleado indicado no existe');
  }
  const milli = toMilli(input.quantity);
  const [row] = await db
    .insert(stockMovements)
    .values({
      productId: input.productId,
      kind: input.kind,
      date: input.date ?? today,
      quantityMilli: input.kind === 'use' ? -milli : milli,
      visitId: input.visitId ?? null,
      userId: input.userId ?? null,
      note: input.note ?? null,
    })
    .returning({ id: stockMovements.id });
  return getMovement(db, row!.id);
}

export async function deleteMovement(db: Db, id: number) {
  await getMovement(db, id);
  await db.delete(stockMovements).where(eq(stockMovements.id, id));
  return { ok: true as const };
}

/**
 * Products used at a visit (employee closing it). Every product must exist and be active; runs inside the caller's
 * transaction so a rejected product leaves the visit untouched.
 */
export async function recordVisitUse(
  db: Db,
  date: IsoDate,
  visitId: number,
  userId: number,
  lines: z.infer<typeof productUseInput>[],
) {
  if (lines.length === 0) return [];
  const ids = [...new Set(lines.map((l) => l.productId))];
  const found = await db
    .select({ id: products.id, name: products.name, unit: products.unit })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.active, true)));
  const byId = new Map(found.map((p) => [p.id, p]));
  if (byId.size !== ids.length) throw badRequest('Algún producto no existe o está dado de baja');
  await db.insert(stockMovements).values(
    lines.map((l) => ({ productId: l.productId, kind: 'use' as const, date, quantityMilli: -toMilli(l.quantity), visitId, userId })),
  );
  return lines.map((l) => ({ productId: l.productId, name: byId.get(l.productId)!.name, unit: byId.get(l.productId)!.unit, quantity: l.quantity }));
}

/** Product used (`use` movements only) in a month, per product and per day. */
export async function stockUsage(db: Db, month: IsoMonth) {
  const { from, to } = monthRange(month);
  const rows = await db
    .select({
      date: stockMovements.date,
      productId: stockMovements.productId,
      name: products.name,
      unit: products.unit,
      milli: sql<number>`-sum(${stockMovements.quantityMilli})`.mapWith(Number),
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .where(and(eq(stockMovements.kind, 'use'), gte(stockMovements.date, from), lte(stockMovements.date, to)))
    .groupBy(stockMovements.date, stockMovements.productId, products.name, products.unit)
    .orderBy(asc(stockMovements.date), asc(products.name));

  const totals = new Map<number, { productId: number; name: string; unit: string; milli: number }>();
  const days = new Map<string, { productId: number; used: number }[]>();
  for (const r of rows) {
    const total = totals.get(r.productId) ?? { productId: r.productId, name: r.name, unit: r.unit, milli: 0 };
    total.milli += r.milli;
    totals.set(r.productId, total);
    const items = days.get(r.date) ?? [];
    items.push({ productId: r.productId, used: fromMilli(r.milli) });
    days.set(r.date, items);
  }
  return {
    month,
    products: [...totals.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ milli, ...p }) => ({ ...p, used: fromMilli(milli) })),
    days: [...days.entries()].map(([date, items]) => ({ date, items })),
  };
}
