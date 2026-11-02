import type { IsoDate, IsoMonth } from './types.js';

/** A non-voided invoice with what has been allocated to it. */
export interface MonthInvoiceInput {
  id: number;
  number: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  /** Billing period (`YYYY-MM`) of monthly fees; null for visits, manual and legacy invoices. */
  periodMonth: IsoMonth | null;
  description: string;
  amountCents: number;
  paidCents: number;
}

export interface DebtMonthInvoice {
  id: number;
  number: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  description: string;
  amountCents: number;
  paidCents: number;
  /** amountCents - paidCents (what a payment can still allocate to this invoice). */
  balanceCents: number;
}

export interface DebtMonth {
  month: IsoMonth;
  /** Sum of the amounts of the open invoices of the month. */
  billedCents: number;
  /** Already allocated to those invoices. */
  paidCents: number;
  /** Unallocated client credit netted against this month (credit is applied oldest month first). */
  creditAppliedCents: number;
  /** billed - paid - creditApplied. */
  owedCents: number;
  /** Open invoices of the month, oldest due first. */
  invoices: DebtMonthInvoice[];
}

export interface DebtByMonth {
  /** Months with at least one open invoice, oldest first. */
  months: DebtMonth[];
  /** Sum of `owedCents`; equals the client balance whenever the balance is not negative. */
  totalOwedCents: number;
  /** Credit left after netting every month (positive only when the client has a balance in favour). */
  creditCents: number;
}

/** Month an invoice belongs to: its billing period, or the month it was issued. */
export function invoiceMonth(invoice: { periodMonth: IsoMonth | null; issuedOn: IsoDate }): IsoMonth {
  return invoice.periodMonth ?? invoice.issuedOn.slice(0, 7);
}

const byDue = (a: DebtMonthInvoice, b: DebtMonthInvoice) =>
  a.dueOn.localeCompare(b.dueOn) || a.issuedOn.localeCompare(b.issuedOn) || a.id - b.id;

/**
 * Groups a client's open invoices by month. Pass only non-voided invoices; paid ones are ignored.
 * Unallocated credit is netted oldest month first, so the total matches `clientBalance().balanceCents`.
 */
export function debtByMonth(invoices: MonthInvoiceInput[], creditCents = 0): DebtByMonth {
  const groups = new Map<IsoMonth, DebtMonthInvoice[]>();
  for (const inv of invoices) {
    const balanceCents = inv.amountCents - inv.paidCents;
    if (balanceCents <= 0) continue;
    const month = invoiceMonth(inv);
    const list = groups.get(month) ?? [];
    list.push({
      id: inv.id,
      number: inv.number,
      issuedOn: inv.issuedOn,
      dueOn: inv.dueOn,
      description: inv.description,
      amountCents: inv.amountCents,
      paidCents: inv.paidCents,
      balanceCents,
    });
    groups.set(month, list);
  }

  let credit = Math.max(0, creditCents);
  const months: DebtMonth[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      list.sort(byDue);
      const billedCents = list.reduce((s, i) => s + i.amountCents, 0);
      const paidCents = list.reduce((s, i) => s + i.paidCents, 0);
      const open = billedCents - paidCents;
      const creditAppliedCents = Math.min(credit, open);
      credit -= creditAppliedCents;
      return { month, billedCents, paidCents, creditAppliedCents, owedCents: open - creditAppliedCents, invoices: list };
    });

  return { months, totalOwedCents: months.reduce((s, m) => s + m.owedCents, 0), creditCents: credit };
}
