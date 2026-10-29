import { eq } from 'drizzle-orm';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { invoices, payments } from '../db/schema.js';
import { allocationsForPayments, selectInvoices, toInvoiceView, withInvoiceItems } from './accounts.js';
import { clientSummary, requireClient } from './clients.js';
import { listCertificates } from './certificates.js';
import { listVisits } from './visits.js';

export interface LedgerEntry {
  date: IsoDate;
  type: 'invoice' | 'payment';
  id: number;
  /** Invoice number, or payment method for payments. */
  reference: string;
  description: string;
  debitCents: number;
  creditCents: number;
  /** Running balance after this entry (positive = client owes). */
  balanceCents: number;
}

/** Everything the client sheet needs: ledger with running balance, invoices, payments, visits, certificates. */
export async function clientStatement(db: Db, today: IsoDate, clientId: number) {
  const client = await requireClient(db, clientId);
  const [summary, invoiceRows, paymentRows, visitRows, certs] = await Promise.all([
    clientSummary(db, today, clientId),
    selectInvoices(db, eq(invoices.clientId, clientId)),
    db.select().from(payments).where(eq(payments.clientId, clientId)),
    listVisits(db, { clientId }),
    listCertificates(db, today, { clientId }),
  ]);
  const allocs = await allocationsForPayments(
    db,
    paymentRows.map((p) => p.id),
  );

  const invoiceViews = await withInvoiceItems(
    db,
    invoiceRows.map((r) => toInvoiceView(r, today)),
  );
  const activeInvoices = invoiceViews.filter((i) => !i.voided);
  const paymentViews = paymentRows.map((p) => {
    const list = allocs.get(p.id) ?? [];
    return {
      ...p,
      allocations: list,
      unallocatedCents: p.amountCents - list.reduce((s, a) => s + a.amountCents, 0),
    };
  });

  const entries: Omit<LedgerEntry, 'balanceCents'>[] = [
    ...activeInvoices.map((i) => ({
      date: i.issuedOn,
      type: 'invoice' as const,
      id: i.id,
      reference: i.number,
      description: i.description,
      debitCents: i.amountCents,
      creditCents: 0,
    })),
    ...paymentViews.map((p) => ({
      date: p.paidOn,
      type: 'payment' as const,
      id: p.id,
      reference: p.method,
      description: p.notes ?? '',
      debitCents: 0,
      creditCents: p.amountCents,
    })),
  ];
  // Chronological; on the same day invoices come before payments.
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.id - b.id : a.type === 'invoice' ? -1 : 1));
  let running = 0;
  const ledger: LedgerEntry[] = entries.map((e) => {
    running += e.debitCents - e.creditCents;
    return { ...e, balanceCents: running };
  });

  invoiceViews.sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.id - a.id);
  paymentViews.sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.id - a.id);

  return {
    client: { ...client, archived: client.archivedAt !== null },
    summary,
    ledger,
    invoices: invoiceViews,
    payments: paymentViews,
    visits: [...visitRows].reverse(),
    certificates: [...certs].sort((a, b) => b.expiresOn.localeCompare(a.expiresOn)),
  };
}
