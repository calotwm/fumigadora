/** Units a product is counted in. */
export const PRODUCT_UNITS = ['litro', 'ml', 'kg', 'g', 'unidad'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** `purchase` adds stock, `use` takes it out, `adjustment` corrects it either way. */
export const STOCK_MOVEMENT_KINDS = ['purchase', 'use', 'adjustment'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

/** Quantities are stored in thousandths of the unit, so sums never drift (2.5 litros = 2500). */
export function toMilli(quantity: number): number {
  return Math.round(quantity * 1000);
}

export function fromMilli(milli: number): number {
  return milli / 1000;
}

/** True when `quantity` has at most three decimals. */
export function hasMilliPrecision(quantity: number): boolean {
  return Math.abs(quantity * 1000 - Math.round(quantity * 1000)) < 1e-6;
}
