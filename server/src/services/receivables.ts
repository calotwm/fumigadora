import { inArray } from 'drizzle-orm';
import { AGING_BUCKETS, addDays, agingBucket, debtByMonth, diffDays, type AgingBucket, type IsoDate, type IsoMonth } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { clientFinancials, openInvoiceRows, type InvoiceRow } from './accounts.js';
import { balanceFields } from './clients.js';

export interface Debtor {
  clientId: number;
  name: string;
  phone: string | null;
  balanceCents: number;
  overdueCents: number;
  daysOverdue: number;
  /** Due date of the oldest overdue invoice; null when nothing is overdue. */
  overdueSince: IsoDate | null;
  agingBucket: AgingBucket;
  overdueInvoiceCount: number;
  creditCents: number;
  openCents: number;
  /** Oldest month that still has debt after netting credit; null when none. */
  oldestOwedMonth: IsoMonth | null;
  /** Months with debt after netting credit. */
  owedMonthCount: number;
}

/** Clients that owe money, most overdue first (then largest amount). */
export async function listDebtors(db: Db, today: IsoDate, openRows?: InvoiceRow[]): Promise<Debtor[]> {
  const [financials, open] = await Promise.all([clientFinancials(db, today), openRows ?? openInvoiceRows(db)]);
  const owing = [...financials.entries()].filter(([, b]) => b.balanceCents > 0);
  if (owing.length === 0) return [];
  const rows = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone })
    .from(clients)
    .where(
      inArray(
        clients.id,
        owing.map(([id]) => id),
      ),
    );
  const info = new Map(rows.map((r) => [r.id, r]));
  const openByClient = new Map<number, InvoiceRow[]>();
  for (const inv of open) {
    const list = openByClient.get(inv.clientId) ?? [];
    list.push(inv);
    openByClient.set(inv.clientId, list);
  }
  const debtors = owing.map(([id, b]) => {
    const owedMonths = debtByMonth(openByClient.get(id) ?? [], b.creditCents).months.filter((m) => m.owedCents > 0);
    return {
      clientId: id,
      name: info.get(id)?.name ?? '',
      phone: info.get(id)?.phone ?? null,
      ...balanceFields(b),
      overdueSince: b.daysOverdue > 0 ? addDays(today, -b.daysOverdue) : null,
      oldestOwedMonth: owedMonths[0]?.month ?? null,
      owedMonthCount: owedMonths.length,
    };
  });
  debtors.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceCents - a.balanceCents || a.name.localeCompare(b.name, 'es'));
  return debtors;
}

export async function receivables(db: Db, today: IsoDate) {
  const open = await openInvoiceRows(db);
  const debtors = await listDebtors(db, today, open);

  // Aging is computed per open invoice (credit is not netted here; see client balances for that).
  const buckets = new Map<AgingBucket, { totalCents: number; invoiceCount: number; clients: Set<number> }>(
    AGING_BUCKETS.map((b) => [b, { totalCents: 0, invoiceCount: 0, clients: new Set<number>() }]),
  );
  let overdueInvoiceCount = 0;
  let overdueInvoicesCents = 0;
  for (const inv of open) {
    const balance = inv.amountCents - inv.paidCents;
    const days = Math.max(0, diffDays(today, inv.dueOn));
    const bucket = buckets.get(agingBucket(days))!;
    bucket.totalCents += balance;
    bucket.invoiceCount += 1;
    bucket.clients.add(inv.clientId);
    if (days > 0) {
      overdueInvoiceCount += 1;
      overdueInvoicesCents += balance;
    }
  }
  return {
    owedCents: debtors.reduce((s, d) => s + d.balanceCents, 0),
    overdueCents: debtors.reduce((s, d) => s + d.overdueCents, 0),
    openInvoicesCents: open.reduce((s, i) => s + (i.amountCents - i.paidCents), 0),
    overdueInvoicesCents,
    overdueInvoiceCount,
    debtorCount: debtors.length,
    buckets: AGING_BUCKETS.map((b) => {
      const v = buckets.get(b)!;
      return { bucket: b, totalCents: v.totalCents, invoiceCount: v.invoiceCount, clientCount: v.clients.size };
    }),
    debtors,
  };
}
