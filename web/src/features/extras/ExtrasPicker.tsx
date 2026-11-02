import { Minus, Plus } from 'lucide-react';
import { EXTRA_PRICE_PERCENT, extraUnitPriceCents } from '@fumigadora/shared';
import { money } from '../../lib/format';
import type { Extra, ExtraSelection } from '../../lib/types';

const MAX_QUANTITY = 99;

/** Sum of the selected extras, each priced on the service price (`extraUnitPriceCents`, same rule as the server). */
export function extrasTotal(catalog: Extra[], selection: ExtraSelection[], serviceCents: number): number {
  const prices = new Map(catalog.map((e) => [e.id, extraUnitPriceCents(serviceCents, e.priceCents)]));
  return selection.reduce((sum, s) => sum + (prices.get(s.extraId) ?? 0) * s.quantity, 0);
}

/**
 * Catalog of extras with a quantity stepper each (big targets: it is used on a phone in the field).
 * `value` only holds extras with quantity > 0.
 */
export function ExtrasPicker({
  catalog,
  value,
  onChange,
  serviceCents,
}: {
  catalog: Extra[];
  value: ExtraSelection[];
  onChange: (value: ExtraSelection[]) => void;
  /** Price of the visit's service: each extra costs a share of it. */
  serviceCents: number;
}) {
  const quantities = new Map(value.map((s) => [s.extraId, s.quantity]));

  function setQuantity(extraId: number, quantity: number) {
    const next = value.filter((s) => s.extraId !== extraId);
    if (quantity > 0) next.push({ extraId, quantity: Math.min(quantity, MAX_QUANTITY) });
    onChange(next);
  }

  if (catalog.length === 0) return null;
  const total = extrasTotal(catalog, value, serviceCents);

  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps">Extras</span>
      {serviceCents > 0 ? <p className="text-xs text-muted">Cada extra: {EXTRA_PRICE_PERCENT}% del precio del servicio.</p> : null}
      <ul className="border-t border-ink">
        {catalog.map((extra) => {
          const quantity = quantities.get(extra.id) ?? 0;
          return (
            <li key={extra.id} className="flex items-center justify-between gap-3 border-b border-rule py-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{extra.name}</p>
                <p className="num text-sm text-muted">{money(extraUnitPriceCents(serviceCents, extra.priceCents))} c/u</p>
              </div>
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Quitar ${extra.name}`}
                  disabled={quantity === 0}
                  onClick={() => setQuantity(extra.id, quantity - 1)}
                  className="grid size-11 place-items-center border border-ink bg-paper hover:bg-paper-2 disabled:opacity-30"
                >
                  <Minus size={18} aria-hidden />
                </button>
                <span aria-live="polite" className="num w-10 text-center text-lg font-extrabold">
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Agregar ${extra.name}`}
                  onClick={() => setQuantity(extra.id, quantity + 1)}
                  className="grid size-11 place-items-center border border-ink bg-yellow hover:bg-yellow-dark"
                >
                  <Plus size={18} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {total > 0 ? (
        <p className="num text-right text-sm font-semibold">
          Extras: {money(total)}
        </p>
      ) : null}
    </div>
  );
}
