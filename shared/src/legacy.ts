import type { IvaCondition, TaxDocType } from './arca.js';
import { pesosToCents } from './money.js';
import type { ClientKind, IsoDate, IsoMonth, PaymentMethod, VisitStatus } from './types.js';

/**
 * Pure mapping of the legacy system export (gestion.plagamix.com) to this app's domain rows.
 * No I/O: the server importer feeds these drafts into the database.
 */

// ---------- legacy input shapes (only the fields the mapper reads) ----------

export interface LegacyCustomerSummary {
  id: number;
  name: string;
  legalId?: string | null;
  legalIdType?: number | null;
  legalName?: string | null;
  taxConditionId?: number | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  comment?: string | null;
  /** Legacy debt in pesos (sum of the ledger). */
  balance: number;
}

export interface LegacyContactData {
  param?: string | null;
  data?: string | null;
}

export interface LegacyContact {
  id: number;
  name: string;
  ContactData?: LegacyContactData[] | null;
}

export interface LegacyAppointment {
  id: number;
  statusId: number;
  dateStart?: string | null;
  amount?: number | string | null;
  AppointmentType?: { name?: string | null } | null;
}

export interface LegacyCertificate {
  id: number;
  description?: string | null;
  date: string;
  dateExpiration: string;
  appointmentId?: number | null;
  File?: { url?: string | null } | null;
}

export interface LegacyLedgerRow {
  id: number;
  date: string;
  description?: string | null;
  debit?: number | string | null;
  paymentMethodId?: number | null;
  executed: boolean;
  /** Signed amount of this row in pesos (not a running balance). */
  currentAccount: number | string;
}

// ---------- scalar conversions ----------

/** Legacy pesos with decimals (number or numeric string, float artifacts included, may be empty) to integer cents. */
export function legacyPesosToCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const pesos = typeof value === 'number' ? value : Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(pesos)) throw new RangeError(`Invalid pesos amount: ${String(value)}`);
  const cents = pesosToCents(pesos);
  return cents === 0 ? 0 : cents; // avoid -0
}

/** Argentina has no DST: local time is always UTC-3. */
const ARGENTINA_OFFSET_MS = 3 * 3_600_000;

export interface LocalDateTime {
  date: IsoDate;
  /** `HH:MM`. */
  time: string;
}

/** UTC ISO timestamp to the Argentina local date and time. Date-only input is returned as is (time `00:00`). */
export function utcToArgentina(iso: string): LocalDateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso, time: '00:00' };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid legacy date: ${iso}`);
  const local = new Date(ms - ARGENTINA_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Legacy appointment status: 1 Pendiente, 2 Realizada, 3 A concretar, 4 Cancelada. */
export function mapLegacyVisitStatus(statusId: number): VisitStatus {
  if (statusId === 2) return 'done';
  if (statusId === 4) return 'cancelled';
  return 'scheduled';
}

/** Trims and collapses whitespace so the same service never appears twice with different spacing. */
export function normalizeServiceTypeName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ') || 'Servicio';
}

/** Legacy payment methods: 1 Efectivo, 2 Transferencia, 3 Cheque, 4 Mercado Pago, 5 Banco (a bank deposit: transfer). */
export function mapLegacyPaymentMethod(methodId: number | null | undefined): PaymentMethod {
  switch (methodId) {
    case 1:
      return 'cash';
    case 2:
    case 5:
      return 'transfer';
    case 3:
      return 'check';
    case 4:
      return 'mercadopago';
    default:
      return 'other';
  }
}

export interface TaxDocDraft {
  taxDocType: TaxDocType;
  taxDocNumber: string | null;
}

/** `legalIdType`: 80 CUIT and 86 CUIL (both 11 digits, sent to ARCA as CUIT), 96 DNI, 0 none. */
export function mapLegacyTaxDoc(legalIdType: number | null | undefined, legalId: string | null | undefined): TaxDocDraft {
  const digits = (legalId ?? '').replace(/\D/g, '');
  if (!digits) return { taxDocType: 'none', taxDocNumber: null };
  if (legalIdType === 80 || legalIdType === 86) return { taxDocType: 'cuit', taxDocNumber: digits };
  if (legalIdType === 96) return { taxDocType: 'dni', taxDocNumber: digits };
  return { taxDocType: 'none', taxDocNumber: null };
}

/** Tax condition ids: 1 Responsable Inscripto, 2 Exento, 3 Monotributo, 4 Consumidor final, 0 unset (defaults to consumidor final). */
export function mapLegacyIvaCondition(taxConditionId: number | null | undefined): IvaCondition {
  switch (taxConditionId) {
    case 1:
      return 'responsable_inscripto';
    case 2:
      return 'exento';
    case 3:
      return 'monotributo';
    default:
      return 'consumidor_final';
  }
}

export function mapLegacyClientKind(name: string): ClientKind {
  return /^\s*consorcio\b/i.test(name) ? 'building' : 'business';
}

function coordinate(value: string | number | null | undefined, limit: number): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) <= limit ? n : null;
}

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

// ---------- entity drafts ----------

export interface ClientDraft {
  legacyId: number;
  name: string;
  kind: ClientKind;
  address: string | null;
  /** Delivery zone, taken from the legacy city. */
  area: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  taxDocType: TaxDocType;
  taxDocNumber: string | null;
  ivaCondition: IvaCondition;
  legalName: string | null;
}

export function mapLegacyClient(c: LegacyCustomerSummary): ClientDraft {
  const city = clean(c.city);
  return {
    legacyId: c.id,
    name: c.name.trim(),
    kind: mapLegacyClientKind(c.name),
    address: clean(c.address),
    area: city,
    city,
    province: clean(c.province),
    postalCode: clean(c.postalCode),
    latitude: coordinate(c.latitude, 90),
    longitude: coordinate(c.longitude, 180),
    notes: clean(c.comment),
    ...mapLegacyTaxDoc(c.legalIdType, c.legalId),
    ivaCondition: mapLegacyIvaCondition(c.taxConditionId),
    legalName: clean(c.legalName),
  };
}

export interface ContactDraft {
  legacyId: number;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  position: string | null;
  notes: string | null;
}

/** ContactData params: PHON phone, WHAT whatsapp, EMAI email, POSI position; DNIN/ADDR/unlabelled go to the notes. */
export function mapLegacyContact(c: LegacyContact): ContactDraft {
  const draft: ContactDraft = { legacyId: c.id, name: c.name.trim(), phone: null, whatsapp: null, email: null, position: null, notes: null };
  const notes: string[] = [];
  for (const entry of c.ContactData ?? []) {
    const data = clean(entry.data);
    if (!data) continue;
    switch (entry.param) {
      case 'PHON':
        draft.phone ??= data;
        break;
      case 'WHAT':
        draft.whatsapp ??= data;
        break;
      case 'EMAI':
        draft.email ??= data;
        break;
      case 'POSI':
        draft.position ??= data;
        break;
      case 'DNIN':
        notes.push(`DNI: ${data}`);
        break;
      case 'ADDR':
        notes.push(`Address: ${data}`);
        break;
      default:
        notes.push(data);
    }
  }
  draft.notes = notes.length > 0 ? notes.join('\n') : null;
  return draft;
}

export interface VisitDraft {
  legacyId: number;
  date: IsoDate;
  time: string;
  status: VisitStatus;
  serviceTypeName: string;
  priceCents: number;
  /** For done visits, the moment it took place (UTC ISO). */
  completedAt: string | null;
}

/** Returns null for an appointment without a start date (cannot be scheduled). */
export function mapLegacyAppointment(a: LegacyAppointment): VisitDraft | null {
  if (!a.dateStart) return null;
  const { date, time } = utcToArgentina(a.dateStart);
  const status = mapLegacyVisitStatus(a.statusId);
  return {
    legacyId: a.id,
    date,
    time,
    status,
    serviceTypeName: normalizeServiceTypeName(a.AppointmentType?.name),
    priceCents: Math.max(0, legacyPesosToCents(a.amount)),
    completedAt: status === 'done' ? new Date(a.dateStart).toISOString() : null,
  };
}

export interface CertificateDraft {
  legacyId: number;
  /** Legacy certificates have no number: `L-<legacyId>`. */
  number: string;
  issuedOn: IsoDate;
  expiresOn: IsoDate;
  description: string | null;
  legacyFileUrl: string | null;
  /** Legacy id of the appointment (visit) it belongs to, when any. */
  visitLegacyId: number | null;
}

export function mapLegacyCertificate(c: LegacyCertificate): CertificateDraft {
  return {
    legacyId: c.id,
    number: `L-${c.id}`,
    issuedOn: utcToArgentina(c.date).date,
    expiresOn: utcToArgentina(c.dateExpiration).date,
    description: clean(c.description),
    legacyFileUrl: clean(c.File?.url),
    visitLegacyId: c.appointmentId ?? null,
  };
}

// ---------- ledger ----------

export interface InvoiceDraft {
  legacyId: number;
  /** `L-<legacyId>`. */
  number: string;
  issuedOn: IsoDate;
  dueOn: IsoDate;
  amountCents: number;
  description: string;
  periodMonth: IsoMonth;
}

export interface PaymentDraft {
  legacyId: number;
  paidOn: IsoDate;
  amountCents: number;
  method: PaymentMethod;
  notes: string | null;
  /** True when it comes from a negative legacy charge (a credit in favour of the client). */
  isCredit: boolean;
}

export interface LedgerReport {
  /** Positive charges converted to invoices. */
  charges: number;
  /** Executed rows converted to payments. */
  payments: number;
  /** Charges with a zero amount, skipped. */
  zeroSkipped: number;
  /** Negative charges converted to credit payments. */
  negativeCredits: number;
  /** Executed rows without an amount, skipped. */
  emptyPaymentsSkipped: number;
}

export interface LedgerSplit {
  invoices: InvoiceDraft[];
  /** Payments and credits, chronological (date, then legacy id). */
  payments: PaymentDraft[];
  report: LedgerReport;
}

/**
 * Splits a client's ledger: pending rows (`executed = false`) are charges -> invoices; executed rows are
 * payments. Zero charges are skipped and negative charges become credit payments.
 */
export function splitLedger(rows: readonly LegacyLedgerRow[]): LedgerSplit {
  const invoices: InvoiceDraft[] = [];
  const payments: PaymentDraft[] = [];
  const report: LedgerReport = { charges: 0, payments: 0, zeroSkipped: 0, negativeCredits: 0, emptyPaymentsSkipped: 0 };

  for (const row of rows) {
    const date = utcToArgentina(row.date).date;
    const notes = clean(row.description);
    if (row.executed) {
      const debit = legacyPesosToCents(row.debit);
      const cents = debit > 0 ? debit : -legacyPesosToCents(row.currentAccount);
      if (cents <= 0) {
        report.emptyPaymentsSkipped += 1;
        continue;
      }
      payments.push({ legacyId: row.id, paidOn: date, amountCents: cents, method: mapLegacyPaymentMethod(row.paymentMethodId), notes, isCredit: false });
      report.payments += 1;
      continue;
    }
    const cents = legacyPesosToCents(row.currentAccount);
    if (cents === 0) {
      report.zeroSkipped += 1;
    } else if (cents < 0) {
      payments.push({ legacyId: row.id, paidOn: date, amountCents: -cents, method: 'other', notes, isCredit: true });
      report.negativeCredits += 1;
    } else {
      invoices.push({
        legacyId: row.id,
        number: `L-${row.id}`,
        issuedOn: date,
        dueOn: date,
        amountCents: cents,
        description: notes ?? '',
        periodMonth: date.slice(0, 7),
      });
      report.charges += 1;
    }
  }

  payments.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.legacyId - b.legacyId);
  return { invoices, payments, report };
}
