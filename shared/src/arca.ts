import { diffDays, endOfMonth, startOfMonth } from './dates.js';
import type { IsoDate } from './types.js';

// ---------- client fiscal data ----------

export const TAX_DOC_TYPES = ['cuit', 'dni', 'none'] as const;
export type TaxDocType = (typeof TAX_DOC_TYPES)[number];

export const IVA_CONDITIONS = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final', 'no_categorizado'] as const;
export type IvaCondition = (typeof IVA_CONDITIONS)[number];

export const IVA_CONDITION_LABELS: Record<IvaCondition, string> = {
  responsable_inscripto: 'Responsable Inscripto',
  monotributo: 'Monotributo',
  exento: 'IVA Exento',
  consumidor_final: 'Consumidor Final',
  no_categorizado: 'Sujeto no categorizado',
};

/** Tax condition of the company that issues the invoices (Plagamix). */
export const ISSUER_TAX_CONDITIONS = ['monotributo', 'responsable_inscripto'] as const;
export type IssuerTaxCondition = (typeof ISSUER_TAX_CONDITIONS)[number];

export const ARCA_STATUSES = ['not_sent', 'authorized', 'rejected', 'error'] as const;
export type ArcaStatus = (typeof ARCA_STATUSES)[number];

// ---------- CUIT ----------

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Validates the 11-digit CUIT/CUIL (dashes allowed) with the modulo-11 check digit. */
export function isValidCuit(value: string): boolean {
  if (!/^[\d-]+$/.test(value)) return false;
  const d = digitsOnly(value);
  if (d.length !== 11) return false;
  const sum = CUIT_WEIGHTS.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  if (check === 10) return false;
  return check === Number(d[10]);
}

/** `20123456786` -> `20-12345678-6`; returns the input when it is not 11 digits. */
export function formatCuit(value: string): string {
  const d = digitsOnly(value);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : value;
}

/** `20-****5678-6`: hides the middle of the CUIT for status screens. */
export function maskCuit(value: string): string {
  const d = digitsOnly(value);
  return d.length === 11 ? `${d.slice(0, 2)}-****${d.slice(6, 10)}-${d.slice(10)}` : '***';
}

export function isValidDni(value: string): boolean {
  return /^\d{6,9}$/.test(digitsOnly(value)) && digitsOnly(value) === value.replace(/[.\s]/g, '');
}

// ---------- invoice mapping ----------

/** Invoice class codes of WSFEv1 (`CbteTipo`). */
export const ARCA_CBTE = { A: 1, B: 6, C: 11 } as const;
export type ArcaCbteTipo = (typeof ARCA_CBTE)[keyof typeof ARCA_CBTE];
export const ARCA_CBTE_LETTER: Record<number, 'A' | 'B' | 'C'> = { 1: 'A', 6: 'B', 11: 'C' };

/** `CondicionIVAReceptorId` values (FEParamGetCondicionIvaReceptor). */
export const ARCA_RECEPTOR_IVA_ID: Record<IvaCondition, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
  no_categorizado: 7,
};

export const ARCA_DOC_TIPO = { cuit: 80, dni: 96, none: 99 } as const;
/** `AlicIva.Id` for 21%. */
export const ARCA_IVA_21_ID = 5;
export const ARCA_IVA_RATE_21 = 1.21;
/** Concepto 2 = services. */
export const ARCA_CONCEPTO_SERVICES = 2;
/** For Concepto 2/3 ARCA accepts a `CbteFch` up to 10 days before or after the processing date. */
export const ARCA_CBTE_FCH_WINDOW_DAYS = 10;

export class ArcaMappingError extends Error {}

export interface ArcaMappingInput {
  issuerCondition: IssuerTaxCondition;
  ptoVta: number;
  /** Number to request (last authorized + 1). */
  cbteNro: number;
  today: IsoDate;
  invoice: { amountCents: number; issuedOn: IsoDate; dueOn: IsoDate; periodMonth: string | null };
  client: { taxDocType: TaxDocType; taxDocNumber: string | null; ivaCondition: IvaCondition };
}

/** Amounts in cents; dates `YYYY-MM-DD` (the SOAP builder converts both to ARCA formats). */
export interface ArcaInvoiceRequest {
  ptoVta: number;
  cbteTipo: ArcaCbteTipo;
  concepto: number;
  docTipo: number;
  docNro: string;
  cbteNro: number;
  cbteFch: IsoDate;
  impTotalCents: number;
  impTotConcCents: number;
  impNetoCents: number;
  impOpExCents: number;
  impIvaCents: number;
  impTribCents: number;
  fchServDesde: IsoDate;
  fchServHasta: IsoDate;
  fchVtoPago: IsoDate;
  monId: 'PES';
  monCotiz: 1;
  condicionIvaReceptorId: number;
  /** Empty for class C. */
  iva: { id: number; baseImpCents: number; importeCents: number }[];
}

/** Net amount of a VAT-included total at 21%, rounded to the nearest cent. */
export function splitVat21(totalCents: number): { netCents: number; vatCents: number } {
  const netCents = Math.round((totalCents * 100) / 121);
  return { netCents, vatCents: totalCents - netCents };
}

function receptorDocument(client: ArcaMappingInput['client']): { docTipo: number; docNro: string; isCuit: boolean } {
  const raw = client.taxDocNumber?.trim() ?? '';
  if (client.taxDocType === 'cuit') {
    if (!isValidCuit(raw)) throw new ArcaMappingError('El CUIT del cliente no es válido');
    return { docTipo: ARCA_DOC_TIPO.cuit, docNro: digitsOnly(raw), isCuit: true };
  }
  if (client.taxDocType === 'dni') {
    if (!isValidDni(raw)) throw new ArcaMappingError('El DNI del cliente no es válido');
    return { docTipo: ARCA_DOC_TIPO.dni, docNro: digitsOnly(raw), isCuit: false };
  }
  return { docTipo: ARCA_DOC_TIPO.none, docNro: '0', isCuit: false };
}

/**
 * Maps one invoice to the data of a `FECAESolicitar` call.
 * - Monotributo issuer: always Factura C, no VAT breakdown.
 * - Responsable Inscripto issuer: A for receptors that are RI/Monotributo with a CUIT, B for everyone else (21% VAT).
 */
export function mapInvoiceToArca(input: ArcaMappingInput): ArcaInvoiceRequest {
  const { invoice, client } = input;
  if (invoice.amountCents <= 0) throw new ArcaMappingError('El importe de la factura debe ser mayor a cero');
  const doc = receptorDocument(client);

  let cbteTipo: ArcaCbteTipo;
  if (input.issuerCondition === 'monotributo') cbteTipo = ARCA_CBTE.C;
  else if (client.ivaCondition === 'responsable_inscripto' || client.ivaCondition === 'monotributo') {
    if (!doc.isCuit) throw new ArcaMappingError('Para una Factura A el cliente necesita un CUIT válido en sus datos fiscales');
    cbteTipo = ARCA_CBTE.A;
  } else cbteTipo = ARCA_CBTE.B;

  const total = invoice.amountCents;
  const vat = cbteTipo === ARCA_CBTE.C ? null : splitVat21(total);

  const cbteFch = Math.abs(diffDays(invoice.issuedOn, input.today)) <= ARCA_CBTE_FCH_WINDOW_DAYS ? invoice.issuedOn : input.today;
  const [servFrom, servTo] = invoice.periodMonth
    ? [startOfMonth(`${invoice.periodMonth}-01`), endOfMonth(`${invoice.periodMonth}-01`)]
    : [invoice.issuedOn, invoice.issuedOn];

  return {
    ptoVta: input.ptoVta,
    cbteTipo,
    concepto: ARCA_CONCEPTO_SERVICES,
    docTipo: doc.docTipo,
    docNro: doc.docNro,
    cbteNro: input.cbteNro,
    cbteFch,
    impTotalCents: total,
    impTotConcCents: 0,
    impNetoCents: vat ? vat.netCents : total,
    impOpExCents: 0,
    impIvaCents: vat ? vat.vatCents : 0,
    impTribCents: 0,
    fchServDesde: servFrom,
    fchServHasta: servTo,
    fchVtoPago: invoice.dueOn < cbteFch ? cbteFch : invoice.dueOn,
    monId: 'PES',
    monCotiz: 1,
    condicionIvaReceptorId: ARCA_RECEPTOR_IVA_ID[client.ivaCondition],
    iva: vat ? [{ id: ARCA_IVA_21_ID, baseImpCents: vat.netCents, importeCents: vat.vatCents }] : [],
  };
}

/** `0003-00000123`. */
export function formatArcaNumber(ptoVta: number, cbteNro: number): string {
  return `${String(ptoVta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`;
}
