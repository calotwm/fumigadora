import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { ProductOption, ProductUse } from '../../lib/types';
import { UNIT_LABELS } from '../stock/units';

/** Optional "Producto usado" lines when closing a visit: product and quantity in its unit. */
export function ProductsUsedPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: ProductOption[];
  value: ProductUse[];
  onChange: (next: ProductUse[]) => void;
}) {
  const update = (index: number, patch: Partial<ProductUse>) => onChange(value.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const control = 'min-h-11 border border-ink rounded-sm bg-paper px-2 text-base';

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label-caps mb-1">Producto usado (opcional)</legend>
      {value.map((line, index) => {
        const product = catalog.find((p) => p.id === line.productId);
        return (
          <div key={index} className="grid grid-cols-[1fr_6rem_auto_auto] items-center gap-2">
            <select
              aria-label="Producto"
              className={control}
              value={line.productId}
              onChange={(e) => update(index, { productId: Number(e.target.value) })}
            >
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Cantidad"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              className={`${control} num`}
              value={Number.isNaN(line.quantity) || line.quantity === 0 ? '' : line.quantity}
              onChange={(e) => update(index, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
            <span className="text-sm text-muted">{product ? UNIT_LABELS[product.unit] : ''}</span>
            <button
              type="button"
              aria-label="Quitar producto"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="grid size-11 place-items-center hover:bg-paper-2"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
      <Button size="sm" variant="outline" onClick={() => onChange([...value, { productId: catalog[0]!.id, quantity: 0 }])}>
        Agregar producto
      </Button>
    </fieldset>
  );
}
