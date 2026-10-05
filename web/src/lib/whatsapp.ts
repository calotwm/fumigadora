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
  return `Hola ${clientName}, le escribimos de Fumigadora. Le recordamos que registra un saldo pendiente de ${money(balanceCents)}. Si ya realizó el pago, por favor desestime este mensaje. ¡Muchas gracias!`;
}

export function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
