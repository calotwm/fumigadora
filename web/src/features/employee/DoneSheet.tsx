import { useId, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, MoneyInput } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { useMarkMyVisitDone } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import type { MyVisit } from '../../lib/types';

/** Bottom sheet where the employee confirms a service is done and whether the client paid in cash. */
export function DoneSheet({ visit, onClose }: { visit: MyVisit; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useMarkMyVisitDone();
  const suggested = (visit.priceCents ?? 0) > 0 ? visit.priceCents! : visit.clientBalanceCents > 0 ? visit.clientBalanceCents : null;
  const [paid, setPaid] = useState<'yes' | 'no' | null>(null);
  const [amount, setAmount] = useState<number | null>(suggested);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (paid === null) {
      setError('Indicá si el cliente pagó en efectivo.');
      return;
    }
    if (paid === 'yes' && (amount === null || amount <= 0)) {
      setError('Ingresá el importe cobrado.');
      return;
    }
    setError(null);
    mutation.mutate(
      { id: visit.id, cashCollectedCents: paid === 'yes' ? (amount ?? undefined) : undefined },
      {
        onSuccess: () => {
          toast.success(paid === 'yes' && amount ? `Servicio hecho · efectivo ${money(amount)} a rendir` : 'Servicio marcado como hecho');
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
        <Chips
          label="¿Cobró en efectivo?"
          value={paid}
          onChange={setPaid}
          options={[
            { value: 'yes', label: 'Sí' },
            { value: 'no', label: 'No' },
          ]}
        />
        {paid === 'yes' ? (
          <div className="flex flex-col gap-2">
            <MoneyInput label="Importe cobrado" value={amount} onChange={setAmount} autoFocus />
            <div className="flex flex-wrap gap-2">
              {(visit.priceCents ?? 0) > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setAmount(visit.priceCents)}>
                  Precio {money(visit.priceCents!)}
                </Button>
              ) : null}
              {visit.clientBalanceCents > 0 ? (
                <Button size="sm" variant="outline" onClick={() => setAmount(visit.clientBalanceCents)}>
                  Saldo {money(visit.clientBalanceCents)}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted">Queda como efectivo a rendir hasta que el dueño confirme que lo recibió.</p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
