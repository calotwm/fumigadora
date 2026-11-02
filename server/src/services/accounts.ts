import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  clientBalance,
  debtByMonth,
  type ArcaStatus,
  type DebtByMonth,
  invoiceState,
  type ClientBalance,
  type InvoiceStatus,
  type IsoDate,
  type OpenInvoiceForAllocation,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { allocations, invoiceItems, invoices, payments } from '../db/schema.js';

export interface InvoiceRow {
  id: number;
  clientId: number;
  visitId: number | null;
  number: string;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  description: string;
  periodMonth: string | null;
  voidedAt: Date | null;
  arcaStatus: ArcaStatus;
  cbteType: number | null;
  ptoVta: number | null;
  cbteNumber: number | null;
  cae: string | null;
  caeDueOn: string | null;
  arcaObservations: string | null;
  arcaAttemptedAt: Date | null;
  arcaAttemptedNumber: number | null;
  paidCents: number;
}

/** What ARCA said about the invoice (stored as JSON text). */
export interface ArcaDetails {
  observations: { code: number; msg: string }[];
  errors: { code: number; msg: string }[];
  /** Local failure message (network, mapping...). */
  message?: string;
}

function parseArcaDetails(raw: string | null): ArcaDetails | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ArcaDetails;
  } catch {
    return { observations: [], errors: [], message: raw };
  }
}

export interface InvoiceView {
  id: number;
  clientId: number;
  visitId: number | null;
  number: string;
  issuedOn: string;
  dueOn: string;
  amountCents: number;
  description: string;
  periodMonth: string | null;
  voided: boolean;
  status: InvoiceStatus;
  paidCents: number;
  balanceCents: number;
  isPartial: boolean;
  daysOverdue: number;
  arcaStatus: ArcaStatus;
  cbteType: number | null;
  ptoVta: number | null;
  cbteNumber: number | null;
  cae: string | null;
  caeDueOn: string | null;
  arcaObservations: ArcaDetails | null;
  arcaAttemptedAt: Date | null;
}

export interface InvoiceItemView {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}

/**
 * Adds the invoice lines to views. Invoices without stored lines (legacy import, manual, monthly fee, voided history)
 * render as one line built from their description and amount, so every consumer can rely on `items`.
 */
export async function withInvoiceItems<T extends { id: number; description: string; amountCents: number }>(
  db: Db,
  views: T[],
): Promise<(T & { items: InvoiceItemView[] })[]> {
  if (views.length === 0) return [];
  const rows = await db
    .select()
    .from(invoiceItems)
    .where(inArray(invoiceItems.invoiceId, views.map((v) => v.id)))
    .orderBy(invoiceItems.invoiceId, invoiceItems.position);
  const byInvoice = new Map<number, InvoiceItemView[]>();
  for (const r of rows) {
    const list = byInvoice.get(r.invoiceId) ?? [];
    list.push({ description: r.description, quantity: r.quantity, unitPriceCents: r.unitPriceCents, amountCents: r.amountCents });
    byInvoice.set(r.invoiceId, list);
  }
  return views.map((v) => ({
    ...v,
    items: byInvoice.get(v.id) ?? [
      { description: v.description || 'Servicio', quantity: 1, unitPriceCents: v.amountCents, amountCents: v.amountCents },
    ],
  }));
}

const paidSum = sql<number>`coalesce(sum(${allocations.amountCents}), 0)`.mapWith(Number);

/** Invoices with the sum of their allocations (SQL aggregation). */
export async function selectInvoices(db: Db, where?: SQL, onlyOpen = false): Promise<InvoiceRow[]> {
  const query = db
    .select({ ...getTableColumns(invoices), paidCents: paidSum })
    .from(invoices)
    .leftJoin(allocations, eq(allocations.invoiceId, invoices.id))
    .where(where)
    .groupBy(invoices.id);
  const rows = onlyOpen
    ? await query.having(sql`coalesce(sum(${allocations.amountCents}), 0) < ${invoices.amountCents}`)
    : await query;
  return rows as InvoiceRow[];
}

export function toInvoiceView(row: InvoiceRow, today: IsoDate): InvoiceView {
  const state = invoiceState(row, row.paidCents, today);
  const { voidedAt, arcaAttemptedNumber: _attempted, arcaObservations, ...rest } = row;
  return {
    ...rest,
    arcaObservations: parseArcaDetails(arcaObservations),
    voided: voidedAt !== null,
    status: state.status,
    balanceCents: state.balanceCents,
    isPartial: state.isPartial,
    daysOverdue: state.daysOverdue,
  };
}

/** Non-voided invoices with a positive balance, optionally for one client. */
export async function openInvoiceRows(db: Db, clientId?: number): Promise<InvoiceRow[]> {
  const where = clientId === undefined ? isNull(invoices.voidedAt) : and(isNull(invoices.voidedAt), eq(invoices.clientId, clientId));
  return selectInvoices(db, where, true);
}

export async function openInvoicesForAllocation(db: Db, clientId: number): Promise<OpenInvoiceForAllocation[]> {
  const rows = await openInvoiceRows(db, clientId);
  return rows.map((r) => ({
    id: r.id,
    balanceCents: r.amountCents - r.paidCents,
    dueOn: r.dueOn,
    issuedOn: r.issuedOn,
  }));
}

/** Debt broken down by month (open invoices grouped by period or issue month, credit netted oldest first). */
export async function clientDebtMonths(db: Db, clientId: number): Promise<DebtByMonth> {
  const [open, credits] = await Promise.all([openInvoiceRows(db, clientId), clientCredits(db, clientId)]);
  return debtByMonth(open, credits.get(clientId) ?? 0);
}

/** Unallocated payment remainder per client (payments - allocations). */
export async function clientCredits(db: Db, clientId?: number): Promise<Map<number, number>> {
  const paymentTotals = await db
    .select({
      clientId: payments.clientId,
      total: sql<number>`coalesce(sum(${payments.amountCents}), 0)`.mapWith(Number),
    })
    .from(payments)
    .where(clientId === undefined ? undefined : eq(payments.clientId, clientId))
    .groupBy(payments.clientId);

  const allocationTotals = await db
    .select({
      clientId: payments.clientId,
      total: sql<number>`coalesce(sum(${allocations.amountCents}), 0)`.mapWith(Number),
    })
    .from(allocations)
    .innerJoin(payments, eq(payments.id, allocations.paymentId))
    .where(clientId === undefined ? undefined : eq(payments.clientId, clientId))
    .groupBy(payments.clientId);

  const credits = new Map<number, number>();
  for (const p of paymentTotals) credits.set(p.clientId, p.total);
  for (const a of allocationTotals) credits.set(a.clientId, (credits.get(a.clientId) ?? 0) - a.total);
  return credits;
}

/**
 * Balance snapshot per client (only clients with open invoices or credit are present).
 * Use `emptyBalance` for the rest.
 */
export async function clientFinancials(
  db: Db,
  today: IsoDate,
  clientId?: number,
): Promise<Map<number, ClientBalance>> {
  const [open, credits] = await Promise.all([openInvoiceRows(db, clientId), clientCredits(db, clientId)]);
  const byClient = new Map<number, { balanceCents: number; dueOn: string }[]>();
  for (const inv of open) {
    const list = byClient.get(inv.clientId) ?? [];
    list.push({ balanceCents: inv.amountCents - inv.paidCents, dueOn: inv.dueOn });
    byClient.set(inv.clientId, list);
  }
  const ids = new Set<number>([...byClient.keys(), ...[...credits.entries()].filter(([, c]) => c !== 0).map(([id]) => id)]);
  const result = new Map<number, ClientBalance>();
  for (const id of ids) {
    result.set(id, clientBalance(byClient.get(id) ?? [], credits.get(id) ?? 0, today));
  }
  return result;
}

export function emptyBalance(today: IsoDate): ClientBalance {
  return clientBalance([], 0, today);
}

export async function clientFinancial(db: Db, today: IsoDate, clientId: number): Promise<ClientBalance> {
  const map = await clientFinancials(db, today, clientId);
  return map.get(clientId) ?? emptyBalance(today);
}

/** Allocations of the given payments joined with the invoice number. */
export async function allocationsForPayments(db: Db, paymentIds: number[]) {
  if (paymentIds.length === 0) return new Map<number, { invoiceId: number; invoiceNumber: string; amountCents: number }[]>();
  const rows = await db
    .select({
      paymentId: allocations.paymentId,
      invoiceId: allocations.invoiceId,
      invoiceNumber: invoices.number,
      amountCents: allocations.amountCents,
    })
    .from(allocations)
    .innerJoin(invoices, eq(invoices.id, allocations.invoiceId))
    .where(inArray(allocations.paymentId, paymentIds))
    .orderBy(allocations.id);
  const map = new Map<number, { invoiceId: number; invoiceNumber: string; amountCents: number }[]>();
  for (const r of rows) {
    const list = map.get(r.paymentId) ?? [];
    list.push({ invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, amountCents: r.amountCents });
    map.set(r.paymentId, list);
  }
  return map;
}
