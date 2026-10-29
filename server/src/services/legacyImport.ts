import { eq, isNotNull } from 'drizzle-orm';
import {
  allocatePayment,
  legacyPesosToCents,
  mapLegacyAppointment,
  mapLegacyCertificate,
  mapLegacyClient,
  mapLegacyContact,
  normalizeServiceTypeName,
  splitLedger,
  today as businessToday,
  type IsoDate,
  type LegacyAppointment,
  type LegacyCertificate,
  type LegacyContact,
  type LegacyCustomerSummary,
  type LegacyLedgerRow,
  type LedgerReport,
  type OpenInvoiceForAllocation,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { allocations, certificates, clientContacts, clients, invoices, payments, serviceTypes, visits } from '../db/schema.js';
import { clientFinancials, openInvoiceRows } from './accounts.js';

/** The part of the legacy export the importer reads. */
export interface LegacyExport {
  customers: LegacyCustomer[];
}

export interface LegacyCustomer {
  summary: LegacyCustomerSummary;
  detail?: { Certificates?: LegacyCertificate[] | null; Appointments?: LegacyAppointment[] | null } | null;
  currentAccount?: LegacyLedgerRow[] | null;
  contacts?: LegacyContact[] | null;
}

export interface ImportOptions {
  /** Runs the whole import and rolls it back, still returning the full report. */
  dryRun?: boolean;
  /** Commit even when the reconciliation finds clients whose debt differs from the legacy balance. */
  allowMismatches?: boolean;
  /** Business date used for the balance snapshot; defaults to today. */
  today?: IsoDate;
}

export interface EntityCounts {
  inserted: number;
  updated: number;
  /** Not imported (invalid in the source) or already imported and immutable (invoices, payments). */
  skipped: number;
}

export interface BalanceMismatch {
  legacyId: number;
  clientId: number;
  computedCents: number;
  legacyCents: number;
}

export interface ImportReport {
  dryRun: boolean;
  /** False when the import was rolled back (dry run, or mismatches without `allowMismatches`). */
  committed: boolean;
  clients: EntityCounts;
  contacts: EntityCounts;
  visits: EntityCounts;
  certificates: EntityCounts;
  invoices: EntityCounts;
  payments: EntityCounts;
  serviceTypesCreated: number;
  allocationsInserted: number;
  /** Ledger conversion totals across all clients. */
  ledger: LedgerReport;
  reconciliation: {
    clients: number;
    matched: number;
    mismatches: BalanceMismatch[];
  };
}

const emptyCounts = (): EntityCounts => ({ inserted: 0, updated: 0, skipped: 0 });
const CHUNK = 500;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Thrown inside the transaction to roll it back; the report travels with it. */
class RollbackSignal extends Error {
  constructor(readonly report: ImportReport) {
    super('import rolled back');
  }
}

/** Start of the Argentina local day: imported cash is considered handed over the day it was paid. */
const startOfLocalDay = (date: IsoDate) => new Date(`${date}T00:00:00-03:00`);

/**
 * Imports the legacy export in one transaction, upserting by `legacy_id` (safe to re-run, never deletes).
 * Clients, contacts, visits and certificates are overwritten from the source on re-runs; invoices and payments are
 * immutable once imported (allocations derive from them) and only inserted when new. Payments are allocated FIFO
 * per client in chronological order, only when newly inserted.
 */
export async function importLegacy(db: Db, data: LegacyExport, options: ImportOptions = {}): Promise<ImportReport> {
  const dryRun = options.dryRun ?? false;
  try {
    return await db.transaction(async (tx) => {
      const report = await runImport(tx as unknown as Db, data, options);
      const rollBack = dryRun || (report.reconciliation.mismatches.length > 0 && !options.allowMismatches);
      if (rollBack) throw new RollbackSignal(report);
      report.committed = true;
      return report;
    });
  } catch (error) {
    if (error instanceof RollbackSignal) return error.report;
    throw error;
  }
}

async function legacyIdMap(db: Db, table: typeof clients | typeof clientContacts | typeof visits | typeof certificates | typeof invoices | typeof payments) {
  const rows = await db.select({ id: table.id, legacyId: table.legacyId }).from(table).where(isNotNull(table.legacyId));
  return new Map(rows.map((r) => [r.legacyId as number, r.id]));
}

async function runImport(db: Db, data: LegacyExport, options: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = {
    dryRun: options.dryRun ?? false,
    committed: false,
    clients: emptyCounts(),
    contacts: emptyCounts(),
    visits: emptyCounts(),
    certificates: emptyCounts(),
    invoices: emptyCounts(),
    payments: emptyCounts(),
    serviceTypesCreated: 0,
    allocationsInserted: 0,
    ledger: { charges: 0, payments: 0, zeroSkipped: 0, negativeCredits: 0, emptyPaymentsSkipped: 0 },
    reconciliation: { clients: 0, matched: 0, mismatches: [] },
  };

  // ---------- map everything first (pure) ----------
  const customers = data.customers.map((c) => {
    const ledger = splitLedger(c.currentAccount ?? []);
    for (const key of Object.keys(report.ledger) as (keyof LedgerReport)[]) report.ledger[key] += ledger.report[key];
    return {
      legacyBalanceCents: legacyPesosToCents(c.summary.balance),
      client: mapLegacyClient(c.summary),
      contacts: (c.contacts ?? []).map(mapLegacyContact),
      appointments: (c.detail?.Appointments ?? []).map((a) => mapLegacyAppointment(a)),
      certificates: (c.detail?.Certificates ?? []).map(mapLegacyCertificate),
      ledger,
    };
  });

  // ---------- service types: matched by name, created when missing ----------
  const serviceKey = (name: string) => normalizeServiceTypeName(name).toLowerCase();
  const serviceIds = new Map((await db.select({ id: serviceTypes.id, name: serviceTypes.name }).from(serviceTypes)).map((s) => [serviceKey(s.name), s.id]));
  const missingNames = new Map<string, string>();
  for (const c of customers) {
    for (const v of c.appointments) {
      if (v && !serviceIds.has(serviceKey(v.serviceTypeName))) missingNames.set(serviceKey(v.serviceTypeName), v.serviceTypeName);
    }
  }
  if (missingNames.size > 0) {
    const created = await db
      .insert(serviceTypes)
      .values([...missingNames.values()].map((name) => ({ name })))
      .returning({ id: serviceTypes.id, name: serviceTypes.name });
    for (const s of created) serviceIds.set(serviceKey(s.name), s.id);
    report.serviceTypesCreated = created.length;
  }

  // ---------- clients ----------
  const clientIds = await legacyIdMap(db, clients);
  const newClients = customers.filter((c) => !clientIds.has(c.client.legacyId));
  for (const batch of chunks(newClients)) {
    const rows = await db
      .insert(clients)
      .values(batch.map((c) => c.client))
      .returning({ id: clients.id, legacyId: clients.legacyId });
    for (const r of rows) clientIds.set(r.legacyId as number, r.id);
  }
  report.clients.inserted = newClients.length;
  for (const c of customers) {
    if (newClients.includes(c)) continue;
    const { legacyId, ...fields } = c.client;
    await db.update(clients).set(fields).where(eq(clients.legacyId, legacyId));
    report.clients.updated += 1;
  }
  const clientIdOf = (legacyId: number) => clientIds.get(legacyId) as number;

  // ---------- contacts ----------
  const contactIds = await legacyIdMap(db, clientContacts);
  const newContacts: (typeof clientContacts.$inferInsert)[] = [];
  for (const c of customers) {
    for (const contact of c.contacts) {
      const values = { ...contact, clientId: clientIdOf(c.client.legacyId) };
      if (contactIds.has(contact.legacyId)) {
        await db.update(clientContacts).set(values).where(eq(clientContacts.legacyId, contact.legacyId));
        report.contacts.updated += 1;
      } else {
        newContacts.push(values);
      }
    }
  }
  for (const batch of chunks(newContacts)) await db.insert(clientContacts).values(batch);
  report.contacts.inserted = newContacts.length;

  // ---------- visits ----------
  const visitIds = await legacyIdMap(db, visits);
  const newVisits: (typeof visits.$inferInsert)[] = [];
  for (const c of customers) {
    for (const v of c.appointments) {
      if (!v) {
        report.visits.skipped += 1;
        continue;
      }
      const { serviceTypeName, completedAt, ...rest } = v;
      const values = {
        ...rest,
        clientId: clientIdOf(c.client.legacyId),
        serviceTypeId: serviceIds.get(serviceKey(serviceTypeName)) as number,
        completedAt: completedAt ? new Date(completedAt) : null,
      };
      if (visitIds.has(v.legacyId)) {
        await db.update(visits).set(values).where(eq(visits.legacyId, v.legacyId));
        report.visits.updated += 1;
      } else {
        newVisits.push(values);
      }
    }
  }
  for (const batch of chunks(newVisits)) {
    const rows = await db.insert(visits).values(batch).returning({ id: visits.id, legacyId: visits.legacyId });
    for (const r of rows) visitIds.set(r.legacyId as number, r.id);
  }
  report.visits.inserted = newVisits.length;

  // ---------- certificates ----------
  const certificateIds = await legacyIdMap(db, certificates);
  const newCertificates: (typeof certificates.$inferInsert)[] = [];
  for (const c of customers) {
    for (const cert of c.certificates) {
      const { visitLegacyId, ...rest } = cert;
      const values = {
        ...rest,
        clientId: clientIdOf(c.client.legacyId),
        visitId: visitLegacyId === null ? null : (visitIds.get(visitLegacyId) ?? null),
      };
      if (certificateIds.has(cert.legacyId)) {
        await db.update(certificates).set(values).where(eq(certificates.legacyId, cert.legacyId));
        report.certificates.updated += 1;
      } else {
        newCertificates.push(values);
      }
    }
  }
  for (const batch of chunks(newCertificates)) await db.insert(certificates).values(batch);
  report.certificates.inserted = newCertificates.length;

  // ---------- invoices (charges) and payments: insert-only ----------
  const invoiceIds = await legacyIdMap(db, invoices);
  const newInvoices: (typeof invoices.$inferInsert)[] = [];
  for (const c of customers) {
    for (const inv of c.ledger.invoices) {
      if (invoiceIds.has(inv.legacyId)) report.invoices.skipped += 1;
      else newInvoices.push({ ...inv, clientId: clientIdOf(c.client.legacyId) });
    }
  }
  for (const batch of chunks(newInvoices)) await db.insert(invoices).values(batch);
  report.invoices.inserted = newInvoices.length;

  const paymentIds = await legacyIdMap(db, payments);
  /** New payments per client id, chronological. */
  const newPaymentsByClient = new Map<number, { id: number; amountCents: number }[]>();
  for (const c of customers) {
    const clientId = clientIdOf(c.client.legacyId);
    const fresh = c.ledger.payments.filter((p) => !paymentIds.has(p.legacyId));
    report.payments.skipped += c.ledger.payments.length - fresh.length;
    for (const batch of chunks(fresh)) {
      const rows = await db
        .insert(payments)
        .values(
          batch.map(({ isCredit: _isCredit, ...p }) => ({ ...p, clientId, handedOverAt: startOfLocalDay(p.paidOn) })),
        )
        .returning({ id: payments.id, legacyId: payments.legacyId });
      const byLegacy = new Map(rows.map((r) => [r.legacyId as number, r.id]));
      const list = newPaymentsByClient.get(clientId) ?? [];
      for (const p of batch) list.push({ id: byLegacy.get(p.legacyId) as number, amountCents: p.amountCents });
      newPaymentsByClient.set(clientId, list);
    }
    report.payments.inserted += fresh.length;
  }

  // ---------- FIFO allocation of the new payments ----------
  if (newPaymentsByClient.size > 0) {
    const openByClient = new Map<number, OpenInvoiceForAllocation[]>();
    for (const row of await openInvoiceRows(db)) {
      const list = openByClient.get(row.clientId) ?? [];
      list.push({ id: row.id, balanceCents: row.amountCents - row.paidCents, dueOn: row.dueOn, issuedOn: row.issuedOn });
      openByClient.set(row.clientId, list);
    }
    const newAllocations: (typeof allocations.$inferInsert)[] = [];
    for (const [clientId, list] of newPaymentsByClient) {
      const open = openByClient.get(clientId) ?? [];
      for (const payment of list) {
        for (const a of allocatePayment(payment.amountCents, open).allocations) {
          newAllocations.push({ paymentId: payment.id, invoiceId: a.invoiceId, amountCents: a.amountCents });
          open.find((i) => i.id === a.invoiceId)!.balanceCents -= a.amountCents;
        }
      }
    }
    for (const batch of chunks(newAllocations)) await db.insert(allocations).values(batch);
    report.allocationsInserted = newAllocations.length;
  }

  // ---------- reconciliation: the balance the app shows vs the legacy balance ----------
  const balances = await clientFinancials(db, options.today ?? businessToday());
  for (const c of customers) {
    const clientId = clientIdOf(c.client.legacyId);
    const computedCents = balances.get(clientId)?.balanceCents ?? 0;
    report.reconciliation.clients += 1;
    if (computedCents === c.legacyBalanceCents) report.reconciliation.matched += 1;
    else report.reconciliation.mismatches.push({ legacyId: c.client.legacyId, clientId, computedCents, legacyCents: c.legacyBalanceCents });
  }
  return report;
}
