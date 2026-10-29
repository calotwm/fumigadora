import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, INVOICE_STATUSES, monthLabelEs, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { allocations, clients, invoiceItems, invoices } from '../db/schema.js';
import { badRequest, conflict, notFound, zDate, zId, zMonth, zOptText, zPositiveCents } from '../http.js';
import { selectInvoices, toInvoiceView, withInvoiceItems, type InvoiceRow } from './accounts.js';
import { clientNames, requireClient } from './clients.js';

export const DEFAULT_DUE_DAYS = 10;

export const invoiceInput = z.object({
  clientId: zId,
  amountCents: zPositiveCents,
  issuedOn: zDate.optional(),
  dueOn: zDate.optional(),
  description: zOptText(500),
  visitId: zId.nullish(),
  periodMonth: zMonth.nullish(),
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

export const invoiceListQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  clientId: zId.optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});

export const monthlyBatchInput = z.object({
  month: zMonth,
  clientIds: z.array(zId).min(1, 'Seleccioná al menos un cliente').max(1000),
});

async function nextInvoiceNumber(db: Db, year: string): Promise<string> {
  const [row] = await db
    .select({ max: sql<number | null>`max(cast(substring(${invoices.number} from 6) as integer))` })
    .from(invoices)
    .where(sql`${invoices.number} like ${`${year}-%`}`);
  const seq = (row?.max ?? 0) + 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

export interface InvoiceItemArgs {
  description: string;
  quantity: number;
  unitPriceCents: number;
  extraId?: number | null | undefined;
}

export interface CreateInvoiceArgs {
  clientId: number;
  amountCents: number;
  issuedOn: IsoDate;
  dueOn?: IsoDate | undefined;
  description?: string | null | undefined;
  visitId?: number | null | undefined;
  periodMonth?: string | null | undefined;
  /** Optional lines; their sum must equal `amountCents`. */
  items?: InvoiceItemArgs[] | undefined;
}

/** Inserts an invoice with an auto-assigned `YYYY-NNNN` number. Call inside a transaction. */
export async function insertInvoice(db: Db, args: CreateInvoiceArgs): Promise<InvoiceRow> {
  const dueOn = args.dueOn ?? addDays(args.issuedOn, DEFAULT_DUE_DAYS);
  if (dueOn < args.issuedOn) throw badRequest('El vencimiento no puede ser anterior a la emisión');
  const items = args.items ?? [];
  if (items.length > 0 && items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0) !== args.amountCents) {
    throw new RangeError('The invoice lines must add up to the invoice amount');
  }
  const number = await nextInvoiceNumber(db, args.issuedOn.slice(0, 4));
  const [row] = await db
    .insert(invoices)
    .values({
      clientId: args.clientId,
      visitId: args.visitId ?? null,
      number,
      issuedOn: args.issuedOn,
      dueOn,
      amountCents: args.amountCents,
      description: args.description ?? '',
      periodMonth: args.periodMonth ?? null,
    })
    .returning();
  if (items.length > 0) {
    await db.insert(invoiceItems).values(
      items.map((item, position) => ({
        invoiceId: row!.id,
        position,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        amountCents: item.quantity * item.unitPriceCents,
        extraId: item.extraId ?? null,
      })),
    );
  }
  return { ...row!, paidCents: 0 };
}

export async function createInvoice(db: Db, today: IsoDate, input: InvoiceInput) {
  await requireClient(db, input.clientId);
  const row = await db.transaction((tx) =>
    insertInvoice(tx as unknown as Db, { ...input, issuedOn: input.issuedOn ?? today }),
  );
  const [view] = await withInvoiceItems(db, [toInvoiceView(row, today)]);
  return view!;
}

export async function listInvoices(db: Db, today: IsoDate, q: z.infer<typeof invoiceListQuery>) {
  const conditions: (SQL | undefined)[] = [];
  if (q.clientId) conditions.push(eq(invoices.clientId, q.clientId));
  if (q.from) conditions.push(gte(invoices.issuedOn, q.from));
  if (q.to) conditions.push(lte(invoices.issuedOn, q.to));
  if (q.status !== 'void') conditions.push(isNull(invoices.voidedAt));
  const rows = await selectInvoices(db, and(...conditions));
  const names = await clientNames(
    db,
    rows.map((r) => r.clientId),
  );
  const filtered = rows
    .map((r) => ({ ...toInvoiceView(r, today), clientName: names.get(r.clientId) ?? '' }))
    .filter((i) => (q.status ? i.status === q.status : true));
  const views = await withInvoiceItems(db, filtered);
  views.sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.id - a.id);
  return views;
}

export async function getInvoice(db: Db, today: IsoDate, id: number) {
  const [row] = await selectInvoices(db, eq(invoices.id, id));
  if (!row) throw notFound('Factura');
  const names = await clientNames(db, [row.clientId]);
  const [view] = await withInvoiceItems(db, [{ ...toInvoiceView(row, today), clientName: names.get(row.clientId) ?? '' }]);
  return view!;
}

/** Voids an invoice. Payments allocated to it are released back as client credit. */
export async function voidInvoice(db: Db, today: IsoDate, id: number) {
  const current = await getInvoice(db, today, id);
  if (current.voided) throw conflict('La factura ya está anulada');
  await db.transaction(async (tx) => {
    await tx.delete(allocations).where(eq(allocations.invoiceId, id));
    await tx.update(invoices).set({ voidedAt: new Date() }).where(eq(invoices.id, id));
  });
  return getInvoice(db, today, id);
}

// ---------- monthly fee ("abono") batch ----------

/** Active clients with a monthly fee and no non-voided invoice for `month`. */
export async function monthlyBatchPreview(db: Db, month: string) {
  const invoiced = await db
    .select({ clientId: invoices.clientId })
    .from(invoices)
    .where(and(eq(invoices.periodMonth, month), isNull(invoices.voidedAt)));
  const invoicedIds = new Set(invoiced.map((i) => i.clientId));
  const rows = await db
    .select({ id: clients.id, name: clients.name, monthlyFeeCents: clients.monthlyFeeCents })
    .from(clients)
    .where(and(isNull(clients.archivedAt), sql`${clients.monthlyFeeCents} > 0`))
    .orderBy(clients.name);
  const pending = rows
    .filter((c) => !invoicedIds.has(c.id))
    .map((c) => ({ clientId: c.id, name: c.name, monthlyFeeCents: c.monthlyFeeCents! }));
  return {
    month,
    label: monthLabelEs(month),
    clients: pending,
    totalCents: pending.reduce((s, c) => s + c.monthlyFeeCents, 0),
    alreadyInvoicedCount: invoicedIds.size,
  };
}

export async function monthlyBatchCreate(db: Db, today: IsoDate, input: z.infer<typeof monthlyBatchInput>) {
  const ids = [...new Set(input.clientIds)];
  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const rows = await tx
      .select({ id: clients.id, monthlyFeeCents: clients.monthlyFeeCents, archivedAt: clients.archivedAt })
      .from(clients)
      .where(inArray(clients.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const invoiced = await tx
      .select({ clientId: invoices.clientId })
      .from(invoices)
      .where(and(eq(invoices.periodMonth, input.month), isNull(invoices.voidedAt), inArray(invoices.clientId, ids)));
    const invoicedIds = new Set(invoiced.map((i) => i.clientId));

    const created: InvoiceRow[] = [];
    const skipped: { clientId: number; reason: string }[] = [];
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) skipped.push({ clientId: id, reason: 'Cliente no encontrado' });
      else if (c.archivedAt) skipped.push({ clientId: id, reason: 'Cliente archivado' });
      else if (!c.monthlyFeeCents || c.monthlyFeeCents <= 0) skipped.push({ clientId: id, reason: 'El cliente no tiene abono mensual' });
      else if (invoicedIds.has(id)) skipped.push({ clientId: id, reason: 'Ya tiene factura para este mes' });
      else {
        created.push(
          await insertInvoice(tx, {
            clientId: id,
            amountCents: c.monthlyFeeCents,
            issuedOn: today,
            description: `Abono mensual ${monthLabelEs(input.month)}`,
            periodMonth: input.month,
          }),
        );
      }
    }
    return {
      month: input.month,
      created: await withInvoiceItems(tx, created.map((r) => toInvoiceView(r, today))),
      skipped,
      totalCents: created.reduce((s, r) => s + r.amountCents, 0),
    };
  });
}
