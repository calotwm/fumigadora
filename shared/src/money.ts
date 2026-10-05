/**
 * Money is always an integer number of cents. Never use floats for amounts.
 */

const groupFormatter = new Intl.NumberFormat('es-AR', {
  useGrouping: 'always',
  maximumFractionDigits: 0,
});

/** Formats cents as es-AR currency, e.g. `$ 1.234.567,89`. Negative: `-$ 1.234,50`. */
export function formatMoney(cents: number, opts: { showCents?: boolean } = {}): string {
  if (!Number.isFinite(cents)) throw new RangeError('formatMoney: cents must be finite');
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const showCents = opts.showCents ?? true;
  const wholeText = groupFormatter.format(whole);
  const body = showCents ? `${wholeText},${String(frac).padStart(2, '0')}` : wholeText;
  return `${negative ? '-' : ''}$ ${body}`;
}

function isValidThousands(text: string): boolean {
  if (text === '') return true;
  if (!text.includes('.')) return /^[0-9]+$/.test(text);
  return /^[0-9]{1,3}(\.[0-9]{3})+$/.test(text);
}

/**
 * Parses user input into cents. Accepts es-AR style ("150.000", "150000,50",
 * "1.234.567,89"), plain ("150000", "150000.5") and an optional "$" / spaces.
 * A comma is always the decimal separator. Without a comma, a dot followed by exactly
 * 3 digits (or several dots) is a thousands separator ("150.000"); a dot followed by
 * 1-2 digits is a decimal point. Returns null when the input is not a valid amount.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/\s+/g, '').replace('$', '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

  let intPart: string;
  let fracPart = '';
  const lastComma = s.lastIndexOf(',');
  if (lastComma !== -1) {
    intPart = s.slice(0, lastComma);
    fracPart = s.slice(lastComma + 1);
    if (intPart.includes(',') || fracPart.includes('.') || fracPart === '') return null;
    if (!isValidThousands(intPart)) return null;
    intPart = intPart.replace(/\./g, '');
  } else if (s.includes('.')) {
    const parts = s.split('.');
    const last = parts[parts.length - 1] ?? '';
    if (parts.length > 2 || last.length === 3) {
      if (!isValidThousands(s)) return null;
      intPart = s.replace(/\./g, '');
    } else {
      intPart = parts[0] ?? '';
      fracPart = last;
    }
  } else {
    intPart = s;
  }
  if (intPart === '') intPart = '0';
  if (!/^[0-9]+$/.test(intPart)) return null;
  if (fracPart !== '' && !/^[0-9]{1,2}$/.test(fracPart)) return null;

  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Splits `totalCents` into `parts` integers that sum exactly to the total. */
export function splitCents(totalCents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) throw new RangeError('parts must be a positive integer');
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Converts a decimal peso amount to cents, rounding half up and avoiding float drift (1.005 -> 101). */
export function pesosToCents(pesos: number): number {
  return Math.round(Number((pesos * 100).toPrecision(15)));
}
