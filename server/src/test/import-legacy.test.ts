import { count, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../db/client.js';
import { allocations, certificates, clientContacts, clients, invoices, payments, serviceTypes, visits } from '../db/schema.js';
import { importLegacy, type LegacyCustomer, type LegacyExport, type LegacyFilesBundle } from '../services/legacyImport.js';

// Invented data only: nothing here comes from the real export.
const charge = (id: number, date: string, amount: number) => ({
  id,
  date,
  description: `Charge ${id}`,
  debit: 0,
  paymentMethodId: null,
  executed: false,
  currentAccount: amount,
});
const payment = (id: number, date: string, amount: number, methodId: number | null) => ({
  id,
  date,
  description: `Payment ${id}`,
  debit: amount,
  paymentMethodId: methodId,
  executed: true,
  currentAccount: -amount,
});

function fixture(): LegacyExport {
  const ledgerA = [
    charge(1, '2024-01-10T12:00:00.000Z', 100.1),
    charge(2, '2024-02-10T12:00:00.000Z', 200.2),
    charge(3, '2024-02-11T12:00:00.000Z', 0),
    payment(4, '2024-03-10T12:00:00.000Z', 150.05, 1),
  ];
  const ledgerB = [charge(5, '2024-01-05T12:00:00.000Z', -30), charge(6, '2024-01-06T12:00:00.000Z', 50)];
  const ledgerC = [charge(7, '2024-01-07T12:00:00.000Z', 40), payment(8, '2024-01-20T03:00:00.000Z', 100, 2)];
  const sum = (rows: { currentAccount: number }[]) => rows.reduce((s, r) => s + r.currentAccount, 0);
  const customers: LegacyCustomer[] = [
    {
      summary: {
        id: 101,
        name: 'Consorcio Ejemplo 1',
        legalId: '30-00000000-1',
        legalIdType: 80,
        taxConditionId: 2,
        address: 'Calle Falsa 100',
        city: 'Ciudad Uno',
        province: 'Provincia Uno',
        postalCode: '1000',
        latitude: '-34.6',
        longitude: '-58.4',
        balance: sum(ledgerA),
      },
      detail: {
        Appointments: [
          { id: 11, statusId: 2, dateStart: '2024-01-10T12:00:00.000Z', amount: 100.1, AppointmentType: { name: 'Fumigación' } },
          { id: 12, statusId: 1, dateStart: null, amount: 0, AppointmentType: { name: 'Limpieza de tanque' } },
          { id: 13, statusId: 4, dateStart: '2024-05-01T15:00:00.000Z', amount: 50, AppointmentType: { name: ' Fumigación ' } },
        ],
        Certificates: [
          {
            id: 21,
            description: 'Oblea',
            date: '2024-01-10T12:00:00.000Z',
            dateExpiration: '2024-07-10T12:00:00.000Z',
            appointmentId: 11,
            File: { url: '/files/example.pdf' },
          },
        ],
      },
      currentAccount: ledgerA,
      contacts: [{ id: 31, name: 'Persona Uno', ContactData: [{ param: 'PHON', data: '1100000000' }, { param: 'POSI', data: 'Administrador' }] }],
    },
    {
      summary: { id: 102, name: 'Kiosco Ejemplo', legalIdType: 0, taxConditionId: 0, balance: sum(ledgerB) },
      detail: { Appointments: [], Certificates: [] },
      currentAccount: ledgerB,
      contacts: [],
    },
    {
      summary: { id: 103, name: 'Casa Ejemplo', balance: sum(ledgerC) },
      detail: { Appointments: [], Certificates: [] },
      currentAccount: ledgerC,
      contacts: [],
    },
  ];
  return { customers };
}

async function tableCounts(handle: DbHandle) {
  const n = async (table: PgTable) =>
    Number((await handle.db.select({ n: count() }).from(table))[0]?.n);
  return {
    clients: await n(clients),
    contacts: await n(clientContacts),
    visits: await n(visits),
    certificates: await n(certificates),
    invoices: await n(invoices),
    payments: await n(payments),
    allocations: await n(allocations),
    serviceTypes: await n(serviceTypes),
  };
}

describe('legacy import', () => {
  let handle: DbHandle;
  beforeEach(async () => {
    handle = createDb();
    await handle.migrate();
  });
  afterEach(() => handle.close());

  it('maps every entity and reconciles every balance', async () => {
    const report = await importLegacy(handle.db, fixture(), { today: '2024-06-01' });

    expect(report.committed).toBe(true);
    expect(report.clients).toEqual({ inserted: 3, updated: 0, skipped: 0 });
    expect(report.contacts.inserted).toBe(1);
    expect(report.visits).toEqual({ inserted: 2, updated: 0, skipped: 1 });
    expect(report.certificates.inserted).toBe(1);
    expect(report.invoices.inserted).toBe(4);
    expect(report.payments.inserted).toBe(3);
    expect(report.serviceTypesCreated).toBe(1); // "Fumigación" (both spellings share one); the undated visit is skipped
    expect(report.ledger).toMatchObject({ charges: 4, payments: 2, zeroSkipped: 1, negativeCredits: 1 });
    expect(report.reconciliation.mismatches).toEqual([]);
    expect(report.reconciliation.matched).toBe(3);

    const [a] = await handle.db.select().from(clients).where(eq(clients.legacyId, 101));
    expect(a).toMatchObject({
      kind: 'building',
      area: 'Ciudad Uno',
      city: 'Ciudad Uno',
      postalCode: '1000',
      latitude: -34.6,
      taxDocType: 'cuit',
      taxDocNumber: '30000000001',
      ivaCondition: 'exento',
    });
    const inv = await handle.db.select().from(invoices).where(eq(invoices.clientId, a!.id)).orderBy(invoices.legacyId);
    expect(inv.map((i) => [i.number, i.issuedOn, i.dueOn, i.amountCents, i.periodMonth])).toEqual([
      ['L-1', '2024-01-10', '2024-01-10', 10010, '2024-01'],
      ['L-2', '2024-02-10', '2024-02-10', 20020, '2024-02'],
    ]);
    const [cert] = await handle.db.select().from(certificates);
    const [doneVisit] = await handle.db.select().from(visits).where(eq(visits.legacyId, 11));
    expect(cert).toMatchObject({ number: 'L-21', legacyFileUrl: '/files/example.pdf', visitId: doneVisit!.id, issuedOn: '2024-01-10' });
    expect(doneVisit).toMatchObject({ status: 'done', date: '2024-01-10', priceCents: 10010 });
    const [pay] = await handle.db.select().from(payments).where(eq(payments.legacyId, 4));
    expect(pay).toMatchObject({ paidOn: '2024-03-10', amountCents: 15005, method: 'cash' });
    expect(pay!.handedOverAt?.toISOString()).toBe('2024-03-10T03:00:00.000Z');
  });

  it('allocates payments FIFO and keeps the remainder as credit', async () => {
    await importLegacy(handle.db, fixture(), { today: '2024-06-01' });
    const rows = await handle.db
      .select({ invoice: invoices.number, amount: allocations.amountCents })
      .from(allocations)
      .innerJoin(invoices, eq(invoices.id, allocations.invoiceId))
      .orderBy(invoices.legacyId);
    // client A: 150.05 pays L-1 in full (100.10) and 49.95 of L-2; B: credit 30 covers part of L-6; C: 40 paid, 60 credit.
    expect(rows).toEqual([
      { invoice: 'L-1', amount: 10010 },
      { invoice: 'L-2', amount: 4995 },
      { invoice: 'L-6', amount: 3000 },
      { invoice: 'L-7', amount: 4000 },
    ]);
  });

  it('is idempotent: a second run inserts nothing', async () => {
    await importLegacy(handle.db, fixture(), { today: '2024-06-01' });
    const before = await tableCounts(handle);
    const second = await importLegacy(handle.db, fixture(), { today: '2024-06-01' });

    expect(await tableCounts(handle)).toEqual(before);
    expect(second.clients).toEqual({ inserted: 0, updated: 3, skipped: 0 });
    expect(second.visits.inserted + second.invoices.inserted + second.payments.inserted + second.certificates.inserted).toBe(0);
    expect(second.invoices.skipped).toBe(4);
    expect(second.payments.skipped).toBe(3);
    expect(second.allocationsInserted).toBe(0);
    expect(second.reconciliation.mismatches).toEqual([]);
  });

  it('matches service types by name instead of duplicating them', async () => {
    await handle.db.insert(serviceTypes).values({ name: 'Fumigación', defaultPriceCents: 123 });
    const report = await importLegacy(handle.db, fixture(), { today: '2024-06-01' });
    expect(report.serviceTypesCreated).toBe(0);
    expect(await handle.db.select().from(serviceTypes)).toHaveLength(1);
  });

  it('rolls everything back on a dry run', async () => {
    const report = await importLegacy(handle.db, fixture(), { dryRun: true, today: '2024-06-01' });
    expect(report.committed).toBe(false);
    expect(report.clients.inserted).toBe(3);
    expect(report.reconciliation.mismatches).toEqual([]);
    expect(Object.values(await tableCounts(handle)).every((n) => n === 0)).toBe(true);
  });

  it('reports mismatches and rolls back unless they are allowed', async () => {
    const data = fixture();
    data.customers[0]!.summary.balance += 12.34;

    const rejected = await importLegacy(handle.db, data, { today: '2024-06-01' });
    expect(rejected.committed).toBe(false);
    expect(rejected.reconciliation.mismatches).toEqual([
      expect.objectContaining({ legacyId: 101, computedCents: 15025, legacyCents: 16259 }),
    ]);
    expect((await tableCounts(handle)).clients).toBe(0);

    const allowed = await importLegacy(handle.db, data, { today: '2024-06-01', allowMismatches: true });
    expect(allowed.committed).toBe(true);
    expect((await tableCounts(handle)).clients).toBe(3);
  });

  describe('certificate files', () => {
    let filesDir: string;
    beforeEach(async () => {
      filesDir = await mkdtemp(join(tmpdir(), 'fumigadora-import-'));
    });
    afterEach(() => rm(filesDir, { recursive: true, force: true }));

    // Invented bytes: a few characters starting with the PDF magic number.
    const bundle = (): LegacyFilesBundle => ({
      files: {
        '900': { certificateId: 21, name: 'oblea', extension: 'pdf', base64: Buffer.from('%PDF-1.4 invented').toString('base64') },
        '901': { certificateId: 999, name: 'orphan', extension: 'pdf', base64: Buffer.from('%PDF-orphan').toString('base64') },
      },
    });

    it('writes PDFs after the commit, links them to the certificate and skips them on a re-run', async () => {
      const first = await importLegacy(handle.db, fixture(), { today: '2024-06-01', files: bundle(), filesDir });
      expect(first.files).toEqual({ written: 1, skipped: 0, missing: 1 });
      const [cert] = await handle.db.select().from(certificates);
      expect(cert).toMatchObject({ fileKey: `certificates/${cert!.id}.pdf`, fileSize: 17 });
      expect(await readFile(join(filesDir, cert!.fileKey!), 'utf8')).toBe('%PDF-1.4 invented');

      const second = await importLegacy(handle.db, fixture(), { today: '2024-06-01', files: bundle(), filesDir });
      expect(second.files).toEqual({ written: 0, skipped: 1, missing: 1 });
    });

    it('rewrites a file that went missing from disk', async () => {
      await importLegacy(handle.db, fixture(), { today: '2024-06-01', files: bundle(), filesDir });
      const [cert] = await handle.db.select().from(certificates);
      await rm(join(filesDir, cert!.fileKey!));
      const again = await importLegacy(handle.db, fixture(), { today: '2024-06-01', files: bundle(), filesDir });
      expect(again.files.written).toBe(1);
      expect(await readFile(join(filesDir, cert!.fileKey!), 'utf8')).toBe('%PDF-1.4 invented');
    });

    it('counts but never writes on a dry run', async () => {
      const report = await importLegacy(handle.db, fixture(), { dryRun: true, today: '2024-06-01', files: bundle(), filesDir });
      expect(report.files).toEqual({ written: 1, skipped: 0, missing: 1 });
      await expect(readFile(join(filesDir, 'certificates', '1.pdf'))).rejects.toThrow();
      expect((await tableCounts(handle)).certificates).toBe(0);
    });
  });
});
