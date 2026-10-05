import { diffDays } from './dates.js';
import type { InvoiceStatus, IsoDate } from './types.js';

export interface InvoiceLike {
  amountCents: number;
  dueOn: IsoDate;
  voidedAt?: Date | string | null;
}

export function invoiceBalance(amountCents: number, paidCents: number): number {
  return Math.max(0, amountCents - paidCents);
}

/**
 * Derived invoice status. `overdue` wins over `partial`; use `invoiceState().isPartial`
 * when the partial flag is needed on an overdue invoice.
 */
export function invoiceStatus(invoice: InvoiceLike, paidCents: number, today: IsoDate): InvoiceStatus {
  if (invoice.voidedAt) return 'void';
  if (paidCents >= invoice.amountCents) return 'paid';
  if (today > invoice.dueOn) return 'overdue';
  return paidCents > 0 ? 'partial' : 'pending';
}

export interface InvoiceState {
  status: InvoiceStatus;
  paidCents: number;
  balanceCents: number;
  isPartial: boolean;
  /** Days past dueOn while unpaid; 0 otherwise. */
  daysOverdue: number;
}

export function invoiceState(invoice: InvoiceLike, paidCents: number, today: IsoDate): InvoiceState {
  const status = invoiceStatus(invoice, paidCents, today);
  const open = status !== 'void' && status !== 'paid';
  return {
    status,
    paidCents,
    balanceCents: status === 'void' ? 0 : invoiceBalance(invoice.amountCents, paidCents),
    isPartial: open && paidCents > 0,
    daysOverdue: open && today > invoice.dueOn ? diffDays(today, invoice.dueOn) : 0,
  };
}
