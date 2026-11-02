import { asc, count, eq, inArray } from 'drizzle-orm';
import { extraUnitPriceCents } from '@fumigadora/shared';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { extras, visitExtras } from '../db/schema.js';
import { badRequest, conflict, definedOnly, notFound, zBool, zId, zPositiveCents } from '../http.js';

export const extraInput = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  priceCents: zPositiveCents,
  active: zBool.default(true),
});
export const extraPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  priceCents: zPositiveCents.optional(),
  active: zBool.optional(),
});

/** What the employee (or the owner) adds to a visit when completing it. */
export const extraLineInput = z.object({
  extraId: zId,
  quantity: z.number().int().min(1, 'La cantidad mínima es 1').max(99),
});
export type ExtraLineInput = z.infer<typeof extraLineInput>;

export interface ExtraLine {
  extraId: number;
  name: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

export const listExtras = (db: Db, onlyActive = false) =>
  db.select().from(extras).where(onlyActive ? eq(extras.active, true) : undefined).orderBy(asc(extras.name));

export async function createExtra(db: Db, input: z.infer<typeof extraInput>) {
  const [row] = await db.insert(extras).values(input).returning();
  return row!;
}

export async function updateExtra(db: Db, id: number, patch: z.infer<typeof extraPatch>) {
  const values = definedOnly(patch);
  const [row] =
    Object.keys(values).length > 0
      ? await db.update(extras).set(values).where(eq(extras.id, id)).returning()
      : await db.select().from(extras).where(eq(extras.id, id));
  if (!row) throw notFound('Extra');
  return row;
}

export async function deleteExtra(db: Db, id: number) {
  const [current] = await db.select().from(extras).where(eq(extras.id, id));
  if (!current) throw notFound('Extra');
  const [used] = await db.select({ n: count() }).from(visitExtras).where(eq(visitExtras.extraId, id));
  if ((used?.n ?? 0) > 0) throw conflict('No se puede eliminar: el extra ya se usó en visitas. Desactivalo para que no se ofrezca más.');
  await db.delete(extras).where(eq(extras.id, id));
  return { ok: true as const };
}

/**
 * Resolves the requested extras against the active catalog (same extra twice is merged) and prices them: each one
 * costs a share of `servicePriceCents` (see `extraUnitPriceCents`), or its catalog price when the service has none.
 */
export async function resolveExtraLines(db: Db, items: ExtraLineInput[] | undefined, servicePriceCents: number): Promise<ExtraLine[]> {
  if (!items || items.length === 0) return [];
  const quantities = new Map<number, number>();
  for (const item of items) quantities.set(item.extraId, (quantities.get(item.extraId) ?? 0) + item.quantity);
  const rows = await db
    .select()
    .from(extras)
    .where(inArray(extras.id, [...quantities.keys()]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...quantities].map(([extraId, quantity]) => {
    const row = byId.get(extraId);
    if (!row) throw notFound('Extra');
    if (!row.active) throw badRequest(`El extra "${row.name}" ya no está disponible`);
    if (quantity > 99) throw badRequest(`Cantidad demasiado alta para "${row.name}"`);
    const unitPriceCents = extraUnitPriceCents(servicePriceCents, row.priceCents);
    return { extraId, name: row.name, quantity, unitPriceCents, amountCents: unitPriceCents * quantity };
  });
}
