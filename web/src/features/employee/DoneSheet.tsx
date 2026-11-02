import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, MoneyInput, Textarea } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { useMarkMyVisitDone, useMyExtras, useMyProducts } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import type { ExtraSelection, FieldPaymentMethod, MyVisit, PaymentStatus, ProductUse } from '../../lib/types';
import { ExtrasPicker, extrasTotal } from '../extras/ExtrasPicker';
import { ProductsUsedPicker } from './ProductsUsedPicker';

const METHOD_OPTIONS: { value: FieldPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'mercadopago', label: 'Mercado Pago' },
];

/** Bottom sheet where the employee closes a service: extras, how much the client paid and how. */
export function DoneSheet({ visit, onClose }: { visit: MyVisit; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useMarkMyVisitDone();
  const catalog = useMyExtras().data ?? [];
  const productCatalog = useMyProducts().data ?? [];
  const [extras, setExtras] = useState<ExtraSelection[]>([]);
  const [productsUsed, setProductsUsed] = useState<ProductUse[]>([]);
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [method, setMethod] = useState<FieldPaymentMethod>('cash');
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const base = visit.priceCents ?? 0;
  const extrasCents = extrasTotal(catalog, extras);
  const total = base + extrasCents;
  const statusOptions: { value: PaymentStatus; label: string }[] = [
    ...(total > 0 ? [{ value: 'full' as const, label: 'Pagó todo' }] : []),
    { value: 'partial', label: 'Pagó una parte' },
    { value: 'none', label: 'No pagó' },
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (status === null) {
      setError('Indicá si el cliente pagó.');
      return;
    }
    if (status === 'partial' && (amount === null || amount <= 0)) {
      setError('Ingresá el importe cobrado.');
      return;
    }
    if (productsUsed.some((p) => !(p.quantity > 0))) {
      setError('Indicá la cantidad de cada producto usado.');
      return;
    }
    setError(null);
    const paid = status === 'full' ? total : status === 'partial' ? (amount ?? 0) : 0;
    mutation.mutate(
      {
        id: visit.id,
        body: {
          paymentStatus: status,
          ...(status !== 'none' ? { method } : {}),
          ...(status === 'partial' ? { amountCents: amount! } : {}),
          ...(extras.length > 0 ? { extras } : {}),
          ...(productsUsed.length > 0 ? { products: productsUsed } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          const how = METHOD_OPTIONS.find((o) => o.value === method)?.label.toLowerCase();
          toast.success(
            paid > 0
              ? `Servicio hecho · ${how} ${money(paid)}${method === 'cash' ? ' a rendir' : ''}`
              : 'Servicio marcado como hecho',
          );
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Marcar hecho"
      onClose={onClose}
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="accent" disabled={mutation.isPending} className="min-h-14 flex-[2] text-base">
            {mutation.isPending ? 'Guardando…' : 'Confirmar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <div className="border-l-4 border-ink bg-paper-2 px-3 py-2">
          <p className="text-base font-bold">{visit.clientName}</p>
          <p className="text-sm text-muted">
            {visit.serviceTypeName}
            {visit.time ? ` · ${visit.time}` : ''}
          </p>
        </div>

        <ExtrasPicker catalog={catalog} value={extras} onChange={setExtras} />

        <div className="flex items-baseline justify-between border-y-2 border-ink py-3">
          <span className="label-caps">Total a cobrar</span>
          <span className="num text-3xl font-extrabold" aria-live="polite">
            {total > 0 ? money(total) : '—'}
          </span>
        </div>
        {visit.clientBalanceCents > 0 ? (
          <p className="-mt-3 text-sm">
            Saldo anterior del cliente: <span className="num font-bold text-red">{money(visit.clientBalanceCents)}</span>
          </p>
        ) : null}

        <Chips label="¿Pagó?" value={status} onChange={setStatus} options={statusOptions} />
        {status === 'partial' ? (
          <div className="flex flex-col gap-2">
            <MoneyInput label="Importe cobrado" value={amount} onChange={setAmount} autoFocus />
            {visit.clientBalanceCents > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAmount(visit.clientBalanceCents + total)}>
                  Todo, con saldo anterior {money(visit.clientBalanceCents + total)}
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-muted">Se aplica primero a esta visita y lo que sobre, a la deuda más vieja.</p>
          </div>
        ) : null}
        {status === 'full' || status === 'partial' ? (
          <div className="flex flex-col gap-1">
            <Chips label="¿Cómo pagó?" value={method} onChange={setMethod} options={METHOD_OPTIONS} />
            {method === 'cash' ? (
              <p className="text-xs text-muted">Queda como efectivo a rendir hasta que el dueño confirme que lo recibió.</p>
            ) : null}
          </div>
        ) : null}

        {productCatalog.length > 0 ? <ProductsUsedPicker catalog={productCatalog} value={productsUsed} onChange={setProductsUsed} /> : null}

        <Textarea label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
