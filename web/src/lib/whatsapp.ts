import { addDays, shortDateEs, type IsoDate } from '@fumigadora/shared';
import { money } from './format';

/**
 * Normalizes an Argentine phone number to the digits-only international form used by wa.me.
 * Strips punctuation, the `00` international prefix and the national trunk `0`, and adds `54`
 * when the country code is missing. Returns null when there are no digits.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits === '') return null;
  if (!digits.startsWith('54')) digits = `54${digits.replace(/^0+/, '')}`;
  return digits;
}

export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function debtReminderText(clientName: string, balanceCents: number): string {
  return `Hola ${clientName}, le escribimos de Plagamix. Le recordamos que registra un saldo pendiente de ${money(balanceCents)}. Si ya realizó el pago, por favor desestime este mensaje. ¡Muchas gracias!`;
}

export interface OverdueInvoiceLine {
  number: string;
  dueOn: IsoDate;
  balanceCents: number;
}

/** Overdue invoices as the debt-reminder email picks them: not voided, unpaid balance, due before today; oldest first. */
export function overdueInvoices(
  invoices: readonly (OverdueInvoiceLine & { voided: boolean })[],
  today: IsoDate,
): { invoices: OverdueInvoiceLine[]; totalCents: number } {
  const lines = invoices
    .filter((i) => !i.voided && i.balanceCents > 0 && i.dueOn < today)
    .map((i) => ({ number: i.number, dueOn: i.dueOn, balanceCents: i.balanceCents }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  return { invoices: lines, totalCents: lines.reduce((s, i) => s + i.balanceCents, 0) };
}

/** Grace days of the IPC warning when the setting does not carry a valid value (same default as the server). */
const DEFAULT_IPC_GRACE_DAYS = 10;

/**
 * Date from which the IPC interest warning says interest starts: today + `ipcWarningGraceDays` when the
 * `ipcWarningEnabled` setting is on (same rule as the debt-reminder email), otherwise null. Reads the settings
 * defensively because older servers do not have these keys.
 */
export function ipcInterestFrom(settings: unknown, today: IsoDate): IsoDate | null {
  const s = (settings ?? {}) as { ipcWarningEnabled?: unknown; ipcWarningGraceDays?: unknown };
  if (s.ipcWarningEnabled !== true) return null;
  const grace = s.ipcWarningGraceDays;
  return addDays(today, typeof grace === 'number' && Number.isInteger(grace) && grace >= 1 ? grace : DEFAULT_IPC_GRACE_DAYS);
}

/** Debt reminder for WhatsApp with the same content as the email: overdue invoices, total and the optional IPC warning. */
export function overdueDebtText(input: {
  clientName: string;
  invoices: readonly OverdueInvoiceLine[];
  totalCents: number;
  interestFrom: IsoDate | null;
}): string {
  const blocks = [
    `Hola ${input.clientName}, le escribimos de Plagamix. Le recordamos que, según nuestros registros, las siguientes facturas se encuentran vencidas y con saldo pendiente:`,
    input.invoices.map((i) => `• Factura ${i.number}, vencida el ${shortDateEs(i.dueOn)}: ${money(i.balanceCents)}`).join('\n'),
    `Total adeudado: ${money(input.totalCents)}`,
    'Le agradeceremos regularizar el pago a la brevedad. Si necesita los datos para realizar la transferencia o desea coordinar otra forma de pago, responda a este mensaje.',
    ...(input.interestFrom
      ? [
          `Le informamos que, si el saldo vencido no se regulariza antes del ${shortDateEs(input.interestFrom)}, a partir de esa fecha comenzará a aplicarse sobre él un interés calculado según la variación del Índice de Precios al Consumidor (IPC) publicado por el INDEC.`,
        ]
      : []),
    'Si ya realizó el pago, desestime este mensaje. ¡Muchas gracias!',
  ];
  return blocks.join('\n\n');
}

export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function visitReminderText(clientName: string, service: string, dateLabel: string, time: string | null): string {
  return `Hola ${clientName}, le recordamos que el ${dateLabel}${time ? ` a las ${time}` : ""} realizaremos el servicio de ${service}. Ante cualquier consulta, escribanos. ¡Muchas gracias!`;
}
