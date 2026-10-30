/** Each extra added to a visit costs this share of the service price. */
export const EXTRA_PRICE_PERCENT = 30;

/**
 * Unit price of an extra: `EXTRA_PRICE_PERCENT` of the service price (rounded to the cent).
 * Only when the service has no price does the extra keep its own catalog price.
 */
export function extraUnitPriceCents(servicePriceCents: number, catalogPriceCents: number): number {
  return servicePriceCents > 0 ? Math.round((servicePriceCents * EXTRA_PRICE_PERCENT) / 100) : catalogPriceCents;
}
