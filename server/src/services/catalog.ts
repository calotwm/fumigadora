import { asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { cashEntries, clients, expenseCategories, serviceTypes, visits } from '../db/schema.js';
import { conflict, definedOnly, notFound, zCents } from '../http.js';

// ---------- service types ----------

export const serviceTypeInput = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
    defaultPriceCents: zCents.default(0),
    issuesCertificate: z.boolean().default(false),
    certificateValidityDays: z.number().int().positive().max(3650).nullish(),
  })
  .refine((v) => !v.issuesCertificate || !!v.certificateValidityDays, {
    message: 'Indicá la vigencia de la oblea en días',
    path: ['certificateValidityDays'],
  });
export const serviceTypePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  defaultPriceCents: zCents.optional(),
  issuesCertificate: z.boolean().optional(),
  certificateValidityDays: z.number().int().positive().max(3650).nullish(),
});

export const listServiceTypes = (db: Db) => db.select().from(serviceTypes).orderBy(asc(serviceTypes.name));

export async function createServiceType(db: Db, input: z.infer<typeof serviceTypeInput>) {
  const [row] = await db
    .insert(serviceTypes)
    .values({
      ...input,
      certificateValidityDays: input.issuesCertificate ? (input.certificateValidityDays ?? null) : null,
    })
    .returning();
  return row!;
}

export async function updateServiceType(db: Db, id: number, patch: z.infer<typeof serviceTypePatch>) {
  const [current] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, id));
  if (!current) throw notFound('Tipo de servicio');
  const merged = { ...current, ...definedOnly(patch) };
  if (merged.issuesCertificate && !merged.certificateValidityDays) {
    throw conflict('Indicá la vigencia de la oblea en días', 'validation');
  }
  if (!merged.issuesCertificate) merged.certificateValidityDays = null;
  const [row] = await db
    .update(serviceTypes)
    .set({
      name: merged.name,
      defaultPriceCents: merged.defaultPriceCents,
      issuesCertificate: merged.issuesCertificate,
      certificateValidityDays: merged.certificateValidityDays,
    })
    .where(eq(serviceTypes.id, id))
    .returning();
  return row!;
}

export async function deleteServiceType(db: Db, id: number) {
  const [current] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, id));
  if (!current) throw notFound('Tipo de servicio');
  const [used] = await db.select({ n: count() }).from(visits).where(eq(visits.serviceTypeId, id));
  if ((used?.n ?? 0) > 0) throw conflict('No se puede eliminar: el servicio tiene visitas registradas');
  const [planned] = await db.select({ n: count() }).from(clients).where(eq(clients.defaultServiceTypeId, id));
  if ((planned?.n ?? 0) > 0) throw conflict('No se puede eliminar: hay clientes con este servicio habitual');
  await db.delete(serviceTypes).where(eq(serviceTypes.id, id));
  return { ok: true as const };
}

// ---------- expense categories ----------

export const categoryInput = z.object({ name: z.string().trim().min(1, 'El nombre es obligatorio').max(80) });

export const listCategories = (db: Db) => db.select().from(expenseCategories).orderBy(asc(expenseCategories.id));

export async function createCategory(db: Db, input: z.infer<typeof categoryInput>) {
  const [row] = await db.insert(expenseCategories).values(input).returning();
  return row!;
}

/**
 * Id of the first category whose name matches one of `names` (case-insensitive, in that order of preference);
 * creates one named `names[0]` when none exists. Used by expenses the system files on its own (salaries, fuel).
 */
export async function ensureCategory(db: Db, names: [string, ...string[]]): Promise<number> {
  const rows = await db.select().from(expenseCategories).orderBy(asc(expenseCategories.id));
  for (const name of names) {
    const found = rows.find((r) => r.name.trim().toLowerCase() === name.toLowerCase());
    if (found) return found.id;
  }
  const [row] = await db.insert(expenseCategories).values({ name: names[0] }).returning({ id: expenseCategories.id });
  return row!.id;
}

export async function updateCategory(db: Db, id: number, input: z.infer<typeof categoryInput>) {
  const [row] = await db.update(expenseCategories).set(input).where(eq(expenseCategories.id, id)).returning();
  if (!row) throw notFound('Categoría');
  return row;
}

export async function deleteCategory(db: Db, id: number) {
  const [current] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, id));
  if (!current) throw notFound('Categoría');
  const [used] = await db.select({ n: count() }).from(cashEntries).where(eq(cashEntries.categoryId, id));
  if ((used?.n ?? 0) > 0) throw conflict('No se puede eliminar: la categoría tiene gastos registrados');
  await db.delete(expenseCategories).where(eq(expenseCategories.id, id));
  return { ok: true as const };
}
