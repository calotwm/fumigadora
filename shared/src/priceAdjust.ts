/**
 * IPC price update: a forward-looking change of list prices. Money stays integer cents;
 * never applied to invoices already issued.
 */

export const PRICE_ROUNDINGS = ['none', '100', '1000'] as const;
/** `none` = to the cent; `100` = to $100; `1000` = to $1.000. */
export type PriceRounding = (typeof PRICE_ROUNDINGS)[number];

/** Where prices live: service type defaults, catalog extras, scheduled visits with their own price, client monthly fees. */
export const PRICE_SCOPES = ['serviceTypes', 'extras', 'visits', 'monthlyFees'] as const;
export type PriceScope = (typeof PRICE_SCOPES)[number];

const ROUNDING_STEP_CENTS: Record<PriceRounding, bigint> = { none: 1n, '100': 100_00n, '1000': 1_000_00n };

/** `3.2` -> `320`. Percentages carry at most two decimals. */
export function percentToBasisPoints(percent: number): number {
  const bp = Math.round(Number((percent * 100).toPrecision(15)));
  if (!Number.isFinite(percent) || Math.abs(percent * 100 - bp) > 1e-6) {
    throw new RangeError('percent must have at most two decimals');
  }
  return bp;
}

/** Integer division rounding half up (away from zero for the half), exact for any bigint. */
function divRoundHalfUp(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = (abs * 2n + divisor) / (divisor * 2n);
  return negative ? -q : q;
}

/**
 * New price after raising `cents` by `basisPoints` (320 = 3.2 %): round half up to the cent,
 * then round half up to the chosen step. A zero price stays zero.
 */
export function adjustPrice(cents: number, basisPoints: number, rounding: PriceRounding = 'none'): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('cents must be a non-negative integer');
  if (!Number.isInteger(basisPoints) || basisPoints <= -10_000) throw new RangeError('basisPoints must be an integer above -10000');
  const raised = divRoundHalfUp(BigInt(cents) * BigInt(10_000 + basisPoints), 10_000n);
  const step = ROUNDING_STEP_CENTS[rounding];
  const result = divRoundHalfUp(raised, step) * step;
  return Number(result);
}
