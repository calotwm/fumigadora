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
 * `target` puts invoices first: one id (the employee's visit invoice) or the ids the owner selected
 * (paid in chronological order). Any remainder continues FIFO over the other open invoices before becoming credit.
 */
export function allocatePayment(
  amountCents: number,
  openInvoices: OpenInvoiceForAllocation[],
  target?: number | readonly number[] | null,
): AllocationResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError('amountCents must be a positive integer');
  }
  const fifo = openInvoices
    .filter((i) => i.balanceCents > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id);

  let ordered = fifo;
  if (target != null) {
    const first = new Set(typeof target === 'number' ? [target] : target);
    for (const id of first) {
      if (!fifo.some((i) => i.id === id)) throw new RangeError('Target invoice is not open');
    }
    if (first.size > 0) ordered = [...fifo.filter((i) => first.has(i.id)), ...fifo.filter((i) => !first.has(i.id))];
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
