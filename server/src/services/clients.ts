import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, ilike } from 'drizzle-orm';
import { z } from 'zod';
import type { ClientBalance, IsoDate } from '@fumigadora/shared';
import { CLIENT_KINDS, FREQUENCIES, IVA_CONDITIONS, TAX_DOC_TYPES, digitsOnly, isValidCuit, isValidDni } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { certificates, clients, invoices, payments, serviceTypes, visits, type Client } from '../db/schema.js';
import { badRequest, definedOnly, hhmm, likePattern, notFound, zCents, zId, zOptText } from '../http.js';
import { clientFinancial, clientFinancials, emptyBalance } from './accounts.js';

export const clientInput = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  kind: z.enum(CLIENT_KINDS).default('business'),
  contactName: zOptText(200),
  phone: zOptText(60),
  email: zOptText(200),
  address: zOptText(300),
  area: zOptText(120),
  notes: zOptText(2000),
  taxId: zOptText(40),
  monthlyFeeCents: zCents.nullish(),
  /** Service plan; `none` (default) = not tracked in the monthly follow-up. */
  serviceFrequency: z.enum(FREQUENCIES).optional(),
  defaultServiceTypeId: zId.nullish(),
  /** Fiscal data ("Datos fiscales") used for electronic invoicing. */
  taxDocType: z.enum(TAX_DOC_TYPES).optional(),
  taxDocNumber: zOptText(20),
  ivaCondition: z.enum(IVA_CONDITIONS).optional(),
  legalName: zOptText(200),
});
export const clientPatch = clientInput.partial();
export type ClientInput = z.infer<typeof clientInput>;

export const clientListQuery = z.object({
  search: z.string().trim().optional(),
  filter: z.enum(['debt', 'overdue', 'all']).default('all'),
  sort: z.enum(['name', 'balance', 'overdue']).default('name'),
  archived: z.enum(['true', 'false']).default('false'),
});

export async function requireClient(db: Db, id: number): Promise<Client> {
  const [row] = await db.select().from(clients).where(eq(clients.id, id));
  if (!row) throw notFound('Cliente');
  return row;
}

export async function clientNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface NextVisit {
  id: number;
  date: string;
  time: string | null;
  serviceTypeId: number;
  serviceTypeName: string;
}

/** Earliest scheduled visit from `today` on, per client. */
async function nextVisitsByClient(db: Db, today: IsoDate, limitPerClient: number, clientId?: number) {
  const rows = await db
    .select({
      id: visits.id,
      clientId: visits.clientId,
      date: visits.date,
      time: visits.time,
      serviceTypeId: visits.serviceTypeId,
      serviceTypeName: serviceTypes.name,
    })
    .from(visits)
    .innerJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
    .where(
      and(
        eq(visits.status, 'scheduled'),
        gte(visits.date, today),
        clientId === undefined ? undefined : eq(visits.clientId, clientId),
      ),
    )
    .orderBy(asc(visits.date), sql`${visits.time} asc nulls last`, asc(visits.id));
  const map = new Map<number, NextVisit[]>();
  for (const r of rows) {
    const list = map.get(r.clientId) ?? [];
    if (list.length < limitPerClient) {
      list.push({ id: r.id, date: r.date, time: hhmm(r.time), serviceTypeId: r.serviceTypeId, serviceTypeName: r.serviceTypeName });
      map.set(r.clientId, list);
    }
  }
  return map;
}

async function lastVisitDates(db: Db, today: IsoDate, clientId?: number) {
  const rows = await db
    .select({ clientId: visits.clientId, last: sql<string>`max(${visits.date})` })
    .from(visits)
    .where(
      and(
        eq(visits.status, 'done'),
        sql`${visits.date} <= ${today}`,
        clientId === undefined ? undefined : eq(visits.clientId, clientId),
      ),
    )
    .groupBy(visits.clientId);
  return new Map(rows.map((r) => [r.clientId, r.last]));
}

export function balanceFields(b: ClientBalance) {
  return {
    balanceCents: b.balanceCents,
    openCents: b.openCents,
    overdueCents: b.overdueCents,
    creditCents: b.creditCents,
    daysOverdue: b.daysOverdue,
    agingBucket: b.agingBucket,
    overdueInvoiceCount: b.overdueInvoiceCount,
  };
}

export async function listClients(db: Db, today: IsoDate, q: z.infer<typeof clientListQuery>) {
  const conditions = [q.archived === 'true' ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt)];
  if (q.search) {
    const pattern = likePattern(q.search);
    conditions.push(
      or(
        ilike(clients.name, pattern),
        ilike(clients.address, pattern),
        ilike(clients.phone, pattern),
        ilike(clients.contactName, pattern),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(clients)
    .where(and(...conditions));
  const [financials, nextVisits, lastVisits] = await Promise.all([
    clientFinancials(db, today),
    nextVisitsByClient(db, today, 1),
    lastVisitDates(db, today),
  ]);

  let result = rows.map((c) => {
    const bal = financials.get(c.id) ?? emptyBalance(today);
    return {
      ...c,
      archived: c.archivedAt !== null,
      ...balanceFields(bal),
      nextVisit: nextVisits.get(c.id)?.[0] ?? null,
      lastVisitDate: lastVisits.get(c.id) ?? null,
    };
  });
  if (q.filter === 'debt') result = result.filter((c) => c.balanceCents > 0);
  if (q.filter === 'overdue') result = result.filter((c) => c.overdueCents > 0);

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es');
  if (q.sort === 'balance') result.sort((a, b) => b.balanceCents - a.balanceCents || byName(a, b));
  else if (q.sort === 'overdue')
    result.sort((a, b) => b.daysOverdue - a.daysOverdue || b.overdueCents - a.overdueCents || byName(a, b));
  else result.sort(byName);
  return result;
}

export async function clientSummary(db: Db, today: IsoDate, clientId: number) {
  const [bal, nextVisits, lastVisits, lastFreq, counts] = await Promise.all([
    clientFinancial(db, today, clientId),
    nextVisitsByClient(db, today, 5, clientId),
    lastVisitDates(db, today, clientId),
    db
      .select({ frequency: visits.frequency })
      .from(visits)
      .where(and(eq(visits.clientId, clientId), ne(visits.status, 'cancelled')))
      .orderBy(desc(visits.date), desc(visits.id))
      .limit(1),
    Promise.all([
      db.select({ n: count() }).from(visits).where(and(eq(visits.clientId, clientId), eq(visits.status, 'done'))),
      db.select({ n: count() }).from(invoices).where(and(eq(invoices.clientId, clientId), isNull(invoices.voidedAt))),
      db.select({ n: count() }).from(payments).where(eq(payments.clientId, clientId)),
      db.select({ n: count() }).from(certificates).where(eq(certificates.clientId, clientId)),
    ]),
  ]);
  return {
    ...balanceFields(bal),
    nextVisits: nextVisits.get(clientId) ?? [],
    lastVisitDate: lastVisits.get(clientId) ?? null,
    lastFrequency: lastFreq[0]?.frequency ?? 'none',
    counts: {
      doneVisits: counts[0][0]?.n ?? 0,
      invoices: counts[1][0]?.n ?? 0,
      payments: counts[2][0]?.n ?? 0,
      certificates: counts[3][0]?.n ?? 0,
    },
  };
}

export async function getClient(db: Db, today: IsoDate, id: number) {
  const client = await requireClient(db, id);
  return { ...client, archived: client.archivedAt !== null, summary: await clientSummary(db, today, id) };
}

async function requirePlanServiceType(db: Db, id: number | null | undefined) {
  if (id === null || id === undefined) return;
  const [row] = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(eq(serviceTypes.id, id));
  if (!row) throw notFound('Tipo de servicio');
}

/** Validates the document and keeps only its digits. `none` clears the number. */
function normalizeFiscal(type: string, number: string | null | undefined): string | null {
  if (type === 'none') return null;
  const raw = number?.trim() ?? '';
  if (type === 'cuit') {
    if (!isValidCuit(raw)) throw badRequest('El CUIT no es válido (revisá los 11 dígitos)', 'invalid_cuit');
    return digitsOnly(raw);
  }
  if (!isValidDni(raw)) throw badRequest('El DNI no es válido', 'invalid_dni');
  return digitsOnly(raw);
}

export async function createClient(db: Db, input: ClientInput) {
  await requirePlanServiceType(db, input.defaultServiceTypeId);
  const fiscal = { taxDocType: input.taxDocType ?? 'none', taxDocNumber: normalizeFiscal(input.taxDocType ?? 'none', input.taxDocNumber) };
  const [row] = await db
    .insert(clients)
    .values({ ...(definedOnly(input) as typeof clients.$inferInsert), ...fiscal })
    .returning();
  return row!;
}

export async function updateClient(db: Db, id: number, patch: Partial<ClientInput>) {
  const current = await requireClient(db, id);
  await requirePlanServiceType(db, patch.defaultServiceTypeId);
  const values: Record<string, unknown> = definedOnly(patch);
  if (patch.taxDocType !== undefined || patch.taxDocNumber !== undefined) {
    const type = patch.taxDocType ?? current.taxDocType;
    values.taxDocType = type;
    values.taxDocNumber = normalizeFiscal(type, patch.taxDocNumber !== undefined ? patch.taxDocNumber : current.taxDocNumber);
  }
  if (Object.keys(values).length === 0) return requireClient(db, id);
  const [row] = await db.update(clients).set(values).where(eq(clients.id, id)).returning();
  return row!;
}

export async function setArchived(db: Db, id: number, archived: boolean) {
  await requireClient(db, id);
  const [row] = await db
    .update(clients)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(clients.id, id))
    .returning();
  return row!;
}
