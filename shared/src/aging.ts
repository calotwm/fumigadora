import { diffDays } from './dates.js';
import type { AgingBucket, IsoDate } from './types.js';

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export interface OpenInvoice {
  balanceCents: number;
  dueOn: IsoDate;
}

export interface ClientBalance {
  /** Sum of open invoice balances. */
  openCents: number;
  /** Unallocated payment remainder. */
  creditCents: number;
  /** openCents - creditCents. Negative when the client has credit. */
  balanceCents: number;
  /** Past-due part of the debt, reduced by credit (credit is applied oldest-first). */
  overdueCents: number;
  /** today - oldest unpaid dueOn; 0 when nothing is overdue. */
  daysOverdue: number;
  agingBucket: AgingBucket;
  overdueInvoiceCount: number;
}

/**
 * Client balance = open invoice balances - unallocated credit.
 * Pass only non-voided invoices; those with a zero balance are ignored.
 */
export function clientBalance(openInvoices: OpenInvoice[], creditCents: number, today: IsoDate): ClientBalance {
  const open = openInvoices.filter((i) => i.balanceCents > 0).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const openCents = open.reduce((s, i) => s + i.balanceCents, 0);

  let credit = Math.max(0, creditCents);
  let overdueCents = 0;
  let overdueInvoiceCount = 0;
  let oldestOverdueDue: IsoDate | null = null;
  for (const inv of open) {
    const applied = Math.min(credit, inv.balanceCents);
    credit -= applied;
    const remaining = inv.balanceCents - applied;
    if (remaining > 0 && inv.dueOn < today) {
      overdueCents += remaining;
      overdueInvoiceCount += 1;
      oldestOverdueDue ??= inv.dueOn;
    }
  }
  const daysOverdue = oldestOverdueDue ? diffDays(today, oldestOverdueDue) : 0;
  return {
    openCents,
    creditCents,
    balanceCents: openCents - creditCents,
    overdueCents,
    daysOverdue,
    agingBucket: agingBucket(daysOverdue),
    overdueInvoiceCount,
  };
}
