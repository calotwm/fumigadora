import type { ProductUnit, StockMovementKind } from '@fumigadora/shared';

export const UNIT_LABELS: Record<ProductUnit, string> = { litro: 'litros', ml: 'ml', kg: 'kg', g: 'g', unidad: 'unidades' };

export const MOVEMENT_LABELS: Record<StockMovementKind, string> = { purchase: 'Compra', use: 'Uso', adjustment: 'Ajuste' };

/** "2,5" style quantity with up to three decimals. */
export function quantityLabel(quantity: number): string {
  return quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 });
}
