import { useId, useState, type FormEvent } from 'react';
import { PRODUCT_UNITS, monthLabelEs, today, type ProductUnit, type StockMovementKind } from '@fumigadora/shared';
import {
  useCreateStockMovement,
  useDeleteStockMovement,
  useProducts,
  useSaveProduct,
  useStockMovements,
  useStockUsage,
} from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate } from '../../lib/format';
import type { Product, StockMovement } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead, Table } from '../../ui/display';
import { Checkbox, Chips, DateInput, Input, Select } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { MOVEMENT_LABELS, UNIT_LABELS, quantityLabel } from './units';

/** Products with their current stock, purchases/adjustments and what was used this month. */
export function StockPage() {
  const month = today().slice(0, 7);
  const products = useProducts();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [moving, setMoving] = useState<StockMovementKind | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Stock"
        title="Productos"
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing('new')}>
              Nuevo producto
            </Button>
            <Button onClick={() => setMoving('purchase')} disabled={!products.data?.length}>
              Registrar compra
            </Button>
          </>
        }
      />
      <section aria-label="Productos" className="mb-10">
        {products.isLoading ? (
          <Loading />
        ) : products.error || !products.data ? (
          <ErrorNote message={errorMessage(products.error)} onRetry={() => products.refetch()} />
        ) : products.data.length === 0 ? (
          <EmptyState title="Todavía no hay productos." />
        ) : (
          <Table
            caption="Productos y stock actual"
            rows={products.data}
            rowKey={(p) => p.id}
            gridClass="md:grid-cols-[2fr_1fr_1fr_1fr]"
            onRowClick={(p) => setEditing(p)}
            columns={[
              {
                key: 'name',
                header: 'Producto',
                primary: true,
                cell: (p) => (
                  <span className={`font-bold ${p.active ? '' : 'text-muted line-through'}`}>
                    {p.name}
                    {p.belowMin && p.active ? <span className="label-caps ml-2 !text-red">Bajo mínimo</span> : null}
                  </span>
                ),
              },
              {
                key: 'stock',
                header: 'Stock',
                align: 'right',
                cell: (p) => (
                  <span className={`num font-bold ${p.belowMin ? 'text-red' : ''}`}>
                    {quantityLabel(p.stock)} {UNIT_LABELS[p.unit]}
                  </span>
                ),
              },
              {
                key: 'min',
                header: 'Mínimo',
                align: 'right',
                cell: (p) => <span className="num">{p.minQuantity === null ? '—' : `${quantityLabel(p.minQuantity)} ${UNIT_LABELS[p.unit]}`}</span>,
              },
              { key: 'state', header: 'Estado', align: 'right', cell: (p) => <span className="text-sm">{p.active ? 'Activo' : 'De baja'}</span> },
            ]}
          />
        )}
        {products.data?.length ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setMoving('adjustment')}>
              Ajustar stock
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMoving('use')}>
              Registrar uso
            </Button>
          </div>
        ) : null}
      </section>
      <Usage month={month} />
      <Movements month={month} />
      {editing ? <ProductSheet product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {moving && products.data ? <MovementSheet kind={moving} products={products.data.filter((p) => p.active)} onClose={() => setMoving(null)} /> : null}
    </>
  );
}

function Usage({ month }: { month: string }) {
  const { data, error, isLoading, refetch } = useStockUsage(month);
  return (
    <section aria-label="Uso del mes" className="mb-10">
      <SectionHead title={`Uso de ${monthLabelEs(month)}`} />
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data.products.length === 0 ? (
        <EmptyState title="No se registró uso de productos este mes." />
      ) : (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
            {data.products.map((p) => (
              <li key={p.productId} className="text-sm">
                <span className="font-semibold">{p.name}</span>{' '}
                <span className="num font-bold">
                  {quantityLabel(p.used)} {UNIT_LABELS[p.unit]}
                </span>
              </li>
            ))}
          </ul>
          <ul className="border-t border-ink">
            {data.days.map((d) => (
              <li key={d.date} className="grid grid-cols-[56px_1fr] gap-3 border-b border-rule py-2 text-sm">
                <span className="num font-semibold">{fullDate(d.date).slice(0, 5)}</span>
                <span>
                  {d.items
                    .map((i) => {
                      const p = data.products.find((x) => x.productId === i.productId);
                      return `${p?.name ?? ''} ${quantityLabel(i.used)} ${p ? UNIT_LABELS[p.unit] : ''}`;
                    })
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Movements({ month }: { month: string }) {
  const { data, error, isLoading, refetch } = useStockMovements(month);
  const remove = useDeleteStockMovement();
  const toast = useToast();
  const [deleting, setDeleting] = useState<StockMovement | null>(null);
  return (
    <section aria-label="Movimientos de stock">
      <SectionHead title="Movimientos del mes" />
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data.length === 0 ? (
        <EmptyState title="No hay movimientos este mes." />
      ) : (
        <ul className="border-t border-ink">
          {data.map((m) => (
            <li key={m.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-x-3 border-b border-rule py-3">
              <span className="num text-sm font-semibold">{fullDate(m.date).slice(0, 5)}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{m.productName}</p>
                <p className="truncate text-xs text-muted">
                  {MOVEMENT_LABELS[m.kind]}
                  {m.userName ? ` · ${m.userName}` : ''}
                  {m.clientName ? ` · ${m.clientName}` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num whitespace-nowrap font-extrabold">
                  {m.quantity > 0 ? '+' : '−'} {quantityLabel(Math.abs(m.quantity))} {UNIT_LABELS[m.unit]}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(m)} aria-label={`Eliminar movimiento de ${m.productName}`}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting ? (
        <Confirm
          title="Eliminar movimiento"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Movimiento eliminado');
          }}
        >
          <p>
            Se eliminará {MOVEMENT_LABELS[deleting.kind].toLowerCase()} de {deleting.productName} del {fullDate(deleting.date)}. El stock se recalcula.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}

function parseQuantity(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return text.trim() === '' || Number.isNaN(n) ? null : n;
}

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveProduct();
  const [name, setName] = useState(product?.name ?? '');
  const [unit, setUnit] = useState<ProductUnit>(product?.unit ?? 'litro');
  const [min, setMin] = useState(product?.minQuantity === null || !product ? '' : String(product.minQuantity));
  const [active, setActive] = useState(product?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError('Ingresá el nombre.');
    const minQuantity = parseQuantity(min);
    if (min.trim() && (minQuantity === null || minQuantity < 0)) return setError('El mínimo debe ser un número.');
    setError(null);
    save.mutate(
      { id: product?.id, body: { name: name.trim(), unit, minQuantity, ...(product ? { active } : {}) } },
      {
        onSuccess: () => {
          toast.success(product ? 'Producto actualizado' : 'Producto creado');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={product ? 'Editar producto' : 'Nuevo producto'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending} className="flex-[2]">
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={error} autoFocus />
        <Chips label="Unidad" value={unit} onChange={setUnit} options={PRODUCT_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
        <Input label="Stock mínimo (opcional)" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} hint="Por debajo se marca como bajo mínimo." />
        {product ? <Checkbox label="Activo (los empleados lo pueden elegir)" checked={active} onChange={setActive} /> : null}
      </form>
    </Sheet>
  );
}

function MovementSheet({ kind: initialKind, products, onClose }: { kind: StockMovementKind; products: Product[]; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const create = useCreateStockMovement();
  const [kind, setKind] = useState<StockMovementKind>(initialKind);
  const [productId, setProductId] = useState(products[0]?.id ?? 0);
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const product = products.find((p) => p.id === productId);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = parseQuantity(quantity);
    if (q === null || q === 0 || (kind !== 'adjustment' && q < 0)) return setError('Ingresá una cantidad válida.');
    setError(null);
    create.mutate(
      { productId, kind, quantity: q, date, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(`${MOVEMENT_LABELS[kind]} registrada`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Movimiento de stock"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={create.isPending} className="flex-[2]">
            {create.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Chips
          label="Tipo"
          value={kind}
          onChange={setKind}
          options={(['purchase', 'use', 'adjustment'] as const).map((k) => ({ value: k, label: MOVEMENT_LABELS[k] }))}
        />
        <Select label="Producto" value={productId} onChange={(e) => setProductId(Number(e.target.value))}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          label={`Cantidad${product ? ` (${UNIT_LABELS[product.unit]})` : ''}`}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          error={error}
          hint={kind === 'adjustment' ? 'Negativo para descontar (por ejemplo, -0,5).' : undefined}
        />
        <DateInput label="Fecha" value={date} required onChange={(e) => setDate(e.target.value)} />
        <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </form>
    </Sheet>
  );
}
