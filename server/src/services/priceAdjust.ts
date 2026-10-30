import { and, asc, desc, eq, gte, isNotNull, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import {
  PRICE_ROUNDINGS,
  PRICE_SCOPES,
  adjustPrice,
  percentToBasisPoints,
  type IsoDate,
  type PriceRounding,
  type PriceScope,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, extras, priceAdjustments, serviceTypes, visits } from '../db/schema.js';
import { badRequest } from '../http.js';

export const priceAdjustInput = z.object({
  percent: z
    .number()
    .gt(0, 'El porcentaje debe ser mayor a cero')
    .max(100, 'El porcentaje no puede superar 100')
    .refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-6, 'Usá como máximo dos decimales'),
  rounding: z.enum(PRICE_ROUNDINGS).default('none'),
  scopes: z
    .array(z.enum(PRICE_SCOPES))
    .min(1, 'Elegí al menos un tipo de precio')
    .transform((list) => PRICE_SCOPES.filter((s) => list.includes(s))),
});
export type PriceAdjustInput = z.infer<typeof priceAdjustInput>;

export interface PriceChange {
  scope: PriceScope;
  id: number;
  name: string;
  /** Service of a scheduled visit; null for the other scopes. */
  detail: string | null;
  /** Date of a scheduled visit; null for the other scopes. */
  date: IsoDate | null;
  oldCents: number;
  newCents: number;
}

/** Every price in scope with its new value; prices that would not change are left out. */
async function priceChanges(db: Db, today: IsoDate, input: PriceAdjustInput): Promise<PriceChange[]> {
  const bp = percentToBasisPoints(input.percent);
  const rounding: PriceRounding = input.rounding;
  const changes: PriceChange[] = [];
  const add = (scope: PriceScope, id: number, name: string, oldCents: number, visit?: { date: IsoDate; service: string }) => {
    const newCents = adjustPrice(oldCents, bp, rounding);
    if (newCents !== oldCents) {
      changes.push({ scope, id, name, detail: visit?.service ?? null, date: visit?.date ?? null, oldCents, newCents });
    }
  };

  if (input.scopes.includes('serviceTypes')) {
    const rows = await db.select().from(serviceTypes).orderBy(asc(serviceTypes.name), asc(serviceTypes.id));
    for (const r of rows) add('serviceTypes', r.id, r.name, r.defaultPriceCents);
  }
  if (input.scopes.includes('extras')) {
    const rows = await db.select().from(extras).where(eq(extras.active, true)).orderBy(asc(extras.name), asc(extras.id));
    for (const r of rows) add('extras', r.id, r.name, r.priceCents);
  }
  if (input.scopes.includes('visits')) {
    // Only visits still to be done from today on that carry their own price; the rest use the service type default.
    const rows = await db
      .select({ id: visits.id, date: visits.date, priceCents: visits.priceCents, clientName: clients.name, serviceName: serviceTypes.name })
      .from(visits)
      .innerJoin(clients, eq(clients.id, visits.clientId))
      .innerJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
      .where(and(eq(visits.status, 'scheduled'), gte(visits.date, today), isNotNull(visits.priceCents)))
      .orderBy(asc(visits.date), asc(visits.id));
    for (const r of rows) add('visits', r.id, r.clientName, r.priceCents!, { date: r.date, service: r.serviceName });
  }
  if (input.scopes.includes('monthlyFees')) {
    const rows = await db
      .select({ id: clients.id, name: clients.name, fee: clients.monthlyFeeCents })
      .from(clients)
      .where(and(isNull(clients.archivedAt), isNotNull(clients.monthlyFeeCents), gt(clients.monthlyFeeCents, 0)))
      .orderBy(asc(clients.name), asc(clients.id));
    for (const r of rows) add('monthlyFees', r.id, r.name, r.fee!);
  }
  return changes;
}

function summary(input: PriceAdjustInput, items: PriceChange[]) {
  return {
    percent: input.percent,
    percentBasisPoints: percentToBasisPoints(input.percent),
    rounding: input.rounding,
    scopes: input.scopes,
    itemCount: items.length,
    items,
  };
}

/** What `applyPriceAdjustment` would change, without touching anything. */
export async function previewPriceAdjustment(db: Db, today: IsoDate, input: PriceAdjustInput) {
  return summary(input, await priceChanges(db, today, input));
}

/**
 * Raises every price in scope and records the application, in one transaction.
 * Invoices, allocations and balances are never touched: this only changes future prices.
 */
export async function applyPriceAdjustment(
  db: Db,
  today: IsoDate,
  input: PriceAdjustInput,
  user: { userId: number | null; name: string },
) {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const items = await priceChanges(tx, today, input);
    if (items.length === 0) throw badRequest('Ningún precio cambia con este ajuste', 'nothing_to_adjust');
    for (const item of items) {
      if (item.scope === 'serviceTypes') {
        await tx.update(serviceTypes).set({ defaultPriceCents: item.newCents }).where(eq(serviceTypes.id, item.id));
      } else if (item.scope === 'extras') {
        await tx.update(extras).set({ priceCents: item.newCents }).where(eq(extras.id, item.id));
      } else if (item.scope === 'visits') {
        await tx.update(visits).set({ priceCents: item.newCents }).where(eq(visits.id, item.id));
      } else {
        await tx.update(clients).set({ monthlyFeeCents: item.newCents }).where(eq(clients.id, item.id));
      }
    }
    const [row] = await tx
      .insert(priceAdjustments)
      .values({
        percentBasisPoints: percentToBasisPoints(input.percent),
        rounding: input.rounding,
        scopes: input.scopes,
        userId: user.userId,
        userName: user.name,
        itemCount: items.length,
        items,
      })
      .returning();
    return { adjustment: historyView(row!), ...summary(input, items) };
  });
}

function historyView(row: typeof priceAdjustments.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    percent: row.percentBasisPoints / 100,
    percentBasisPoints: row.percentBasisPoints,
    rounding: row.rounding as PriceRounding,
    scopes: row.scopes as PriceScope[],
    userName: row.userName,
    itemCount: row.itemCount,
  };
}

/** Applications, newest first. */
export async function listPriceAdjustments(db: Db) {
  const rows = await db.select().from(priceAdjustments).orderBy(desc(priceAdjustments.createdAt), desc(priceAdjustments.id));
  return rows.map(historyView);
}
