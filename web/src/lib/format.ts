import { formatMoney, isoWeekday, type Frequency, type PaymentMethod, type TaxDocType } from '@fumigadora/shared';

/**
 * es-AR money without trailing ",00": `$ 1.234.567`. Cents are shown only when present.
 * The space after `$` is non-breaking so an amount never wraps between the symbol and the digits.
 */
export function money(cents: number): string {
  return formatMoney(cents, { showCents: Math.round(cents) % 100 !== 0 }).replace('$ ', '$ ');
}

/** Money without the currency symbol, for input fields: `1.234.567`. */
export function moneyPlain(cents: number): string {
  return money(cents).replace('$ ', '');
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `2025-10-05` -> `05/10`. */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** `2025-10-05` -> `05/10/2025`. */
export function fullDate(iso: string): string {
  return `${dayMonth(iso)}/${iso.slice(0, 4)}`;
}

/** `2025-10-05` -> `Domingo 5 de octubre`. */
export function longDate(iso: string): string {
  const weekday = WEEKDAYS[isoWeekday(iso) - 1] ?? '';
  const month = MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
  return `${cap(weekday)} ${Number(iso.slice(8, 10))} de ${month}`;
}

export function overdueLabel(days: number): string {
  return days === 1 ? 'vencido hace 1 día' : `vencido hace ${days} días`;
}

/** `0` -> `hoy`, `1` -> `hace 1 día`, `12` -> `hace 12 días`. */
export function daysAgoLabel(days: number): string {
  if (days <= 0) return 'hoy';
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

export function daysLeftLabel(days: number): string {
  if (days < 0) return Math.abs(days) === 1 ? 'vencida hace 1 día' : `vencida hace ${Math.abs(days)} días`;
  if (days === 0) return 'vence hoy';
  return days === 1 ? 'vence mañana' : `vence en ${days} días`;
}

export const KIND_LABELS: Record<string, string> = {
  business: 'Empresa',
  home: 'Particular',
  building: 'Consorcio',
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  none: 'Sin repetición',
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  yearly: 'Anual',
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mercadopago: 'Mercado Pago',
  check: 'Cheque',
  other: 'Otro',
};

/** Relative change in percent, or null when there is no base to compare with. */
export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function deltaLabel(current: number, previous: number): string {
  const pct = percentDelta(current, previous);
  if (pct === null) return 'Sin datos del mes anterior';
  if (pct === 0) return 'Igual que el mes anterior';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)} % vs. mes anterior`;
}

export const TAX_DOC_LABELS: Record<TaxDocType, string> = {
  none: 'Sin documento',
  cuit: 'CUIT',
  dni: 'DNI',
};

export const TAX_CONDITION_LABELS: Record<string, string> = {
  monotributo: 'Monotributo',
  responsable_inscripto: 'Responsable Inscripto',
};

