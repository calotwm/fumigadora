import type { IsoDate } from './types.js';

export interface OpenInvoiceForAllocation {
  id: number;
  balanceCents: number;
  dueOn: IsoDate;
  issuedOn: IsoDate;
}

export interface Allocation {
  invoiceId: number;
  amountCents: number;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Part of the payment not applied to any invoice (client credit). */
  creditCents: number;
}

/**
 * FIFO allocation: oldest due invoice first (dueOn, issuedOn, id).
 * When `targetInvoiceId` is given, that invoice is paid first (up to its balance) and any
 * remainder continues FIFO over the other open invoices before becoming credit.
 */
export function allocatePayment(
  amountCents: number,
  openInvoices: OpenInvoiceForAllocation[],
  targetInvoiceId?: number | null,
): AllocationResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('amountCents must be a positive integer');
  }
  const fifo = openInvoices
    .filter((i) => i.balanceCents > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id);

  let ordered = fifo;
  if (targetInvoiceId != null) {
    const target = fifo.find((i) => i.id === targetInvoiceId);
    if (!target) throw new RangeError('Target invoice is not open');
    ordered = [target, ...fifo.filter((i) => i.id !== targetInvoiceId)];
  }

  let remaining = amountCents;
  const allocations: Allocation[] = [];
  for (const inv of ordered) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, inv.balanceCents);
    allocations.push({ invoiceId: inv.id, amountCents: applied });
    remaining -= applied;
  }
  return { allocations, creditCents: remaining };
}
