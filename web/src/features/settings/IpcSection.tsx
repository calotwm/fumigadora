import { useState, type FormEvent } from 'react';
import { PRICE_ROUNDINGS, PRICE_SCOPES, type PriceRounding, type PriceScope } from '@fumigadora/shared';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { Checkbox, Chips, Input } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, SectionHead, Table, type Column } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useApplyPriceAdjustment, usePreviewPriceAdjustment, usePriceAdjustments } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate, money } from '../../lib/format';
import type { PriceAdjustmentBody, PriceAdjustmentPreview, PriceChange } from '../../lib/types';

const ROUNDING_LABELS: Record<PriceRounding, string> = { none: 'Sin redondeo', '100': 'A $ 100', '1000': 'A $ 1.000' };

const SCOPE_LABELS: Record<PriceScope, { label: string; hint: string }> = {
  serviceTypes: { label: 'Precios de los servicios', hint: 'Precio por defecto de cada tipo de servicio.' },
  extras: { label: 'Extras', hint: 'Productos y trabajos que se suman al cerrar una visita.' },
  visits: { label: 'Visitas agendadas con precio propio', hint: 'Visitas pendientes de hoy en adelante.' },
  monthlyFees: { label: 'Abonos mensuales', hint: 'Abono de cada cliente activo.' },
};

const SCOPE_SHORT: Record<PriceScope, string> = {
  serviceTypes: 'Servicio',
  extras: 'Extra',
  visits: 'Visita',
  monthlyFees: 'Abono',
};

/** `3,2` or `3.2` -> 3.2; null unless it is above 0, at most 100 and has up to two decimals. */
function parsePercent(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value > 0 && value <= 100 ? value : null;
}

const percentLabel = (p: number) => `${String(p).replace('.', ',')} %`;

/** Ajustes > Ajuste por IPC: raises future prices by a percentage. Issued invoices and balances never change. */
export function IpcSection() {
  const toast = useToast();
  const history = usePriceAdjustments();
  const previewMutation = usePreviewPriceAdjustment();
  const apply = useApplyPriceAdjustment();
  const [percentText, setPercentText] = useState('');
  const [rounding, setRounding] = useState<PriceRounding>('none');
  const [scopes, setScopes] = useState<PriceScope[]>([...PRICE_SCOPES]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ body: PriceAdjustmentBody; result: PriceAdjustmentPreview } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Any change to the parameters discards the preview: what is applied is always what was previewed.
  const reset = () => setPreview(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const percent = parsePercent(percentText);
    if (percent === null) {
      setError('Ingrese un porcentaje mayor a 0 y hasta 100, con hasta dos decimales.');
      return;
    }
    if (scopes.length === 0) {
      setError('Elija al menos un tipo de precio.');
      return;
    }
    setError(null);
    const body = { percent, rounding, scopes };
    previewMutation.mutate(body, {
      onSuccess: (result) => setPreview({ body, result }),
      onError: (e) => setError(errorMessage(e)),
    });
  }

  const columns: Column<PriceChange>[] = [
    {
      key: 'name',
      header: 'Precio',
      primary: true,
      cell: (item) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.name}</p>
          <p className="truncate text-xs text-muted">
            {SCOPE_SHORT[item.scope]}
            {item.date ? ` · ${fullDate(item.date)}` : ''}
            {item.detail ? ` · ${item.detail}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'old', header: 'Actual', align: 'right', cell: (item) => <span className="num whitespace-nowrap text-muted">{money(item.oldCents)}</span> },
    { key: 'new', header: 'Nuevo', align: 'right', cell: (item) => <span className="num whitespace-nowrap font-bold">{money(item.newCents)}</span> },
  ];

  return (
    <section aria-label="Ajuste por IPC" className="lg:col-span-2">
      <SectionHead title="Ajuste por IPC" />
      <p className="mb-4 text-sm text-muted">
        Sube los precios a futuro según el porcentaje de inflación. Las facturas ya emitidas y los saldos de los clientes no cambian.
      </p>
      <form onSubmit={submit} className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Input
            label="Porcentaje"
            inputMode="decimal"
            placeholder="Ej.: 3,2"
            value={percentText}
            onChange={(e) => {
              setPercentText(e.target.value);
              reset();
            }}
            error={error}
            hint="Porcentaje del IPC del período (INDEC), ingresado a mano."
          />
          <Chips
            label="Redondeo"
            value={rounding}
            onChange={(value) => {
              setRounding(value);
              reset();
            }}
            options={PRICE_ROUNDINGS.map((value) => ({ value, label: ROUNDING_LABELS[value] }))}
          />
        </div>
        <fieldset>
          <legend className="label-caps">Qué precios ajustar</legend>
          {PRICE_SCOPES.map((scope) => (
            <Checkbox
              key={scope}
              label={SCOPE_LABELS[scope].label}
              hint={SCOPE_LABELS[scope].hint}
              checked={scopes.includes(scope)}
              onChange={(on) => {
                setScopes((current) => (on ? PRICE_SCOPES.filter((s) => s === scope || current.includes(s)) : current.filter((s) => s !== scope)));
                reset();
              }}
            />
          ))}
        </fieldset>
        <div className="md:col-span-2">
          <Button type="submit" variant="outline" disabled={previewMutation.isPending}>
            {previewMutation.isPending ? 'Calculando…' : 'Ver vista previa'}
          </Button>
        </div>
      </form>

      {preview ? (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="label-caps !text-ink">
              Vista previa · {percentLabel(preview.result.percent)} · {ROUNDING_LABELS[preview.result.rounding]}
            </p>
            <p className="text-sm text-muted">
              {preview.result.itemCount === 1 ? '1 precio cambia' : `${preview.result.itemCount} precios cambian`}
            </p>
          </div>
          {preview.result.items.length === 0 ? (
            <EmptyState title="Ningún precio cambia con este ajuste." />
          ) : (
            <>
              <Table
                caption="Vista previa del ajuste"
                columns={columns}
                rows={preview.result.items}
                rowKey={(item) => `${item.scope}-${item.id}`}
                gridClass="md:grid-cols-[minmax(0,2fr)_1fr_1fr]"
              />
              <div className="mt-4">
                <Button variant="accent" onClick={() => setConfirming(true)}>
                  Aplicar ajuste
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="mt-8">
        <p className="label-caps mb-2 !text-ink">Historial</p>
        {history.isLoading ? (
          <Loading />
        ) : history.error ? (
          <ErrorNote message={errorMessage(history.error)} onRetry={() => history.refetch()} />
        ) : !history.data || history.data.length === 0 ? (
          <EmptyState title="Todavía no se aplicó ningún ajuste." />
        ) : (
          <ul className="border-t border-ink">
            {history.data.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule py-3 text-sm">
                <span className="font-bold">
                  <span className="num">{percentLabel(row.percent)}</span> · {ROUNDING_LABELS[row.rounding]}
                </span>
                <span className="text-muted">
                  <span className="num">{fullDate(row.createdAt.slice(0, 10))}</span> · {row.userName} ·{' '}
                  {row.itemCount === 1 ? '1 precio' : `${row.itemCount} precios`}
                </span>
                <span className="w-full text-xs text-muted">{row.scopes.map((s) => SCOPE_LABELS[s].label).join(' · ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && preview ? (
        <Confirm
          title="Aplicar ajuste por IPC"
          confirmLabel="Aplicar"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await apply.mutateAsync(preview.body);
            toast.success(`Ajuste aplicado: ${result.itemCount === 1 ? '1 precio actualizado' : `${result.itemCount} precios actualizados`}`);
            setPreview(null);
            setPercentText('');
          }}
        >
          <p>
            Se van a actualizar {preview.result.itemCount === 1 ? '1 precio' : `${preview.result.itemCount} precios`} un{' '}
            {percentLabel(preview.result.percent)} ({ROUNDING_LABELS[preview.result.rounding].toLowerCase()}). Las facturas emitidas no cambian.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}
