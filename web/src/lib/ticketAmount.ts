/**
 * Money amounts as printed on Argentine tickets: `44.996,63`, `28 450,50`, `32500,00`, `18.000`. Three decimals
 * (liters, price per liter) never match, and a number is never read from the middle of a longer one.
 */
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{2}))?(?![\d,]|\.\d)/g;

const TOTAL_LINE = /\bT[O0]TAL\b/i;
const PAY_LINE = /\b(IMPORTE|A PAGAR)\b/i;

interface Amount {
  cents: number;
  hasCents: boolean;
}

function amountsIn(line: string): Amount[] {
  return [...line.matchAll(AMOUNT)].map((m) => ({
    cents: Number(m[1]!.replace(/[.\s]/g, '')) * 100 + Number(m[2] ?? 0),
    hasCents: m[2] !== undefined,
  }));
}

const largest = (amounts: Amount[]) => (amounts.length > 0 ? Math.max(...amounts.map((a) => a.cents)) : null);

/**
 * Best guess of a fuel ticket's total from its OCR text, in cents: the last line saying TOTAL (or IMPORTE / A PAGAR),
 * else the largest amount with cents anywhere. Null when nothing looks like an amount. The employee always confirms it.
 */
export function ticketTotalCents(text: string): number | null {
  const lines = text.split(/\r?\n/);
  for (const keyword of [TOTAL_LINE, PAY_LINE]) {
    for (const line of [...lines].reverse()) {
      if (!keyword.test(line)) continue;
      const found = largest(amountsIn(line).filter((a) => a.cents > 0));
      if (found !== null) return found;
    }
  }
  return largest(lines.flatMap(amountsIn).filter((a) => a.hasCents && a.cents > 0));
}
