import { useEffect, useState } from 'react';
import { addMonthsToMonth, monthLabelEs, monthOf, today } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/form';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useBatchPreview, useCreateBatch } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Facturar abonos del mes": preview clients with a fee and no invoice yet, pick, one confirm. */
export function BatchSheet({ onClose }: { onClose: () => void }) {
  const current = monthOf(today());
  const [month, setMonth] = useState(current);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const preview = useBatchPreview(month);
  const create = useCreateBatch();
  const months = [addMonthsToMonth(current, 1), current, addMonthsToMonth(current, -1), addMonthsToMonth(current, -2)];

  useEffect(() => {
    setExcluded(new Set());
  }, [month]);

  const clients = preview.data?.clients ?? [];
  const selected = clients.filter((c) => !excluded.has(c.clientId));
  const total = selected.reduce((sum, c) => sum + c.monthlyFeeCents, 0);

  function toggle(id: number) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    setError(null);
    create.mutate(
      { month, clientIds: selected.map((c) => c.clientId) },
      {
        onSuccess: (result) => {
          toast.success(`${result.created.length} ${result.created.length === 1 ? 'factura creada' : 'facturas creadas'} por ${money(result.totalCents)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Facturar abonos del mes"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button className="flex-[2]" disabled={selected.length === 0 || create.isPending} onClick={confirm}>
            {create.isPending ? 'Facturando…' : `Facturar ${selected.length} · ${money(total)}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Select label="Mes a facturar" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {cap(monthLabelEs(m))}
            </option>
          ))}
        </Select>
        {preview.isLoading ? (
          <Loading />
        ) : preview.error ? (
          <ErrorNote message={errorMessage(preview.error)} />
        ) : clients.length === 0 ? (
          <EmptyState
            title={
              preview.data && preview.data.alreadyInvoicedCount > 0
                ? `Los ${preview.data.alreadyInvoicedCount} abonos de este mes ya fueron facturados.`
                : 'No hay clientes con abono mensual para facturar.'
            }
          />
        ) : (
          <fieldset>
            <legend className="label-caps mb-1">
              {selected.length} de {clients.length} seleccionados
              {preview.data && preview.data.alreadyInvoicedCount > 0 ? ` · ${preview.data.alreadyInvoicedCount} ya facturados` : ''}
            </legend>
            <ul className="border-t border-ink">
              {clients.map((client) => (
                <li key={client.clientId} className="border-b border-rule">
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
                    <input
                      type="checkbox"
                      checked={!excluded.has(client.clientId)}
                      onChange={() => toggle(client.clientId)}
                      className="size-5 accent-ink"
                    />
                    <span className="flex-1 text-sm font-semibold">{client.name}</span>
                    <span className="num text-sm font-bold">{money(client.monthlyFeeCents)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
