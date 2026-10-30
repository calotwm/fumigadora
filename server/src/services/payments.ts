import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { allocatePayment, PAYMENT_METHODS, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { allocations, payments } from '../db/schema.js';
import { badRequest, notFound, zDate, zId, zOptText, zPositiveCents } from '../http.js';
import { allocationsForPayments, clientFinancial, openInvoicesForAllocation } from './accounts.js';
import { balanceFields, clientNames, requireClient } from './clients.js';

export const paymentInput = z.object({
  clientId: zId,
  amountCents: zPositiveCents,
  paidOn: zDate.optional(),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  notes: zOptText(500),
  invoiceId: zId.nullish(),
  /** Invoices (months) the owner chose to settle: paid first in chronological order, the rest goes FIFO. */
  invoiceIds: z.array(zId).max(500).optional(),
});

export const paymentListQuery = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  clientId: zId.optional(),
});

/**
 * Records a payment and allocates it FIFO to the client's oldest open invoices
 * (or to `invoiceId` / the selected `invoiceIds` first). Everything runs in one transaction.
 */
export async function createPayment(
  db: Db,
  today: IsoDate,
  input: z.infer<typeof paymentInput>,
  /**
   * Set when an employee collected the payment in the field. Cash stays "a rendir" until the owner confirms it;
   * pass `handedOver` for money that never passes through the employee's hands (transfer, Mercado Pago).
   */
  collected?: { userId: number; visitId?: number | null; handedOver?: boolean },
) {
  await requireClient(db, input.clientId);
  const created = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const open = await openInvoicesForAllocation(tx, input.clientId);
    const selected = input.invoiceIds ?? [];
    if (input.invoiceId != null && selected.length > 0) {
      throw badRequest('Indicá una factura o una selección de facturas, no ambas');
    }
    if (input.invoiceId != null && !open.some((i) => i.id === input.invoiceId)) {
      throw badRequest('La factura indicada no está pendiente de pago para este cliente');
    }
    if (selected.some((id) => !open.some((i) => i.id === id))) {
      throw badRequest('Alguna de las facturas elegidas no está pendiente de pago para este cliente');
    }
    const target = selected.length > 0 ? selected : input.invoiceId;
    const { allocations: parts, creditCents } = allocatePayment(input.amountCents, open, target);
    const [payment] = await tx
      .insert(payments)
      .values({
        clientId: input.clientId,
        paidOn: input.paidOn ?? today,
        amountCents: input.amountCents,
        method: input.method,
        notes: input.notes ?? null,
        collectedByUserId: collected?.userId ?? null,
        visitId: collected?.visitId ?? null,
        handedOverAt: collected?.handedOver ? new Date() : null,
      })
      .returning();
    if (parts.length > 0) {
      await tx.insert(allocations).values(parts.map((p) => ({ paymentId: payment!.id, ...p })));
    }
    return { payment: payment!, creditCents };
  });
  const allocs = (await allocationsForPayments(db, [created.payment.id])).get(created.payment.id) ?? [];
  const balance = await clientFinancial(db, today, input.clientId);
  return {
    payment: created.payment,
    allocations: allocs,
    creditCents: created.creditCents,
    client: { id: input.clientId, ...balanceFields(balance) },
  };
}

export async function listPayments(db: Db, q: z.infer<typeof paymentListQuery>) {
  const rows = await db
    .select()
    .from(payments)
    .where(
      and(
        q.clientId ? eq(payments.clientId, q.clientId) : undefined,
        q.from ? gte(payments.paidOn, q.from) : undefined,
        q.to ? lte(payments.paidOn, q.to) : undefined,
      ),
    )
    .orderBy(desc(payments.paidOn), desc(payments.id));
  const [names, allocs] = await Promise.all([
    clientNames(
      db,
      rows.map((r) => r.clientId),
    ),
    allocationsForPayments(
      db,
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((p) => {
    const list = allocs.get(p.id) ?? [];
    const allocated = list.reduce((s, a) => s + a.amountCents, 0);
    return {
      ...p,
      clientName: names.get(p.clientId) ?? '',
      allocations: list,
      unallocatedCents: p.amountCents - allocated,
    };
  });
}

/** Deletes a payment and its allocations; the invoices it paid become open again. */
export async function deletePayment(db: Db, today: IsoDate, id: number) {
  const [row] = await db.select().from(payments).where(eq(payments.id, id));
  if (!row) throw notFound('Pago');
  await db.transaction(async (tx) => {
    await tx.delete(allocations).where(eq(allocations.paymentId, id));
    await tx.delete(payments).where(eq(payments.id, id));
  });
  const balance = await clientFinancial(db, today, row.clientId);
  return { ok: true as const, client: { id: row.clientId, ...balanceFields(balance) } };
}
