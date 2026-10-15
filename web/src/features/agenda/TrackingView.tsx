import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { suggestServiceDate, today as todayIso } from '@fumigadora/shared';
import { useTracking } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, daysAgoLabel, dayMonth } from '../../lib/format';
import type { TrackingRow, TrackingStatus } from '../../lib/types';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, ProgressBar } from '../../ui/display';
import { Chips, Select } from '../../ui/form';
import { useActions } from '../actions/ActionsProvider';
import { BatchScheduleSheet } from './BatchScheduleSheet';

type StatusFilter = 'all' | TrackingStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes sin agendar' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'complete', label: 'Completos' },
];

const STATUS_LABELS: Record<TrackingStatus, string> = {
  pending: 'Pendiente sin agendar',
  scheduled: 'Agendado',
  complete: 'Completo',
};

const NO_ZONE = 'Sin zona';

/** "Seguimiento mensual": who has not had their service this month yet, and a one-step way to schedule them. */
export function TrackingView({ month }: { month: string }) {
  const [params, setParams] = useSearchParams();
  const zone = params.get('zona') ?? '';
  const rawStatus = params.get('estado');
  const status: StatusFilter = STATUS_OPTIONS.some((o) => o.value === rawStatus) ? (rawStatus as StatusFilter) : 'all';
  const today = todayIso();
  const { open } = useActions();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);

  const query = useTracking({ month, zone: zone || undefined, status: status === 'all' ? undefined : status });
  const board = query.data;

  // A selection never survives a month change.
  useEffect(() => setSelected(new Set()), [month]);

  function setFilter(key: 'zona' | 'estado', value: string) {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (value === '' || value === 'all') copy.delete(key);
        else copy.set(key, value);
        return copy;
      },
      { replace: true },
    );
  }

  const groups = useMemo(() => {
    const map = new Map<string, TrackingRow[]>();
    for (const row of board?.rows ?? []) {
      const key = row.zone ?? NO_ZONE;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [board]);

  if (query.isLoading) return <Loading />;
  if (query.error || !board) return <ErrorNote message={errorMessage(query.error)} onRetry={() => query.refetch()} />;

  const { totals } = board;
  const suggested = suggestServiceDate(month, today);
  const pendingRows = board.rows.filter((r) => r.status === 'pending');
  const chosen = pendingRows.filter((r) => selected.has(r.clientId));

  function toggle(ids: number[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Avance del mes" className="border-t-4 border-ink pt-3">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <p className="num text-4xl font-extrabold leading-none tracking-tight">
            {totals.done} <span className="text-2xl font-bold text-muted">de {totals.expected}</span>
          </p>
          <p className="text-sm text-muted">
            servicios realizados · {totals.clientsTracked} {totals.clientsTracked === 1 ? 'cliente' : 'clientes'} con plan
          </p>
        </div>
        <div className="mt-3">
          <ProgressBar value={totals.done} max={totals.expected} label="Servicios realizados del mes" />
        </div>
        <p className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <strong>{totals.scheduled}</strong> agendados
          </span>
          <span>
            <strong>{totals.pendingUnscheduled}</strong> pendientes sin agendar
          </span>
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-end">
        <Select label="Zona" value={zone} onChange={(e) => setFilter('zona', e.target.value)}>
          <option value="">Todas las zonas</option>
          {board.zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
        <Chips label="Estado" value={status} options={STATUS_OPTIONS} onChange={(value) => setFilter('estado', value)} />
      </div>

      {pendingRows.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-rule py-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5 accent-ink"
              checked={chosen.length === pendingRows.length}
              onChange={(e) =>
                toggle(
                  pendingRows.map((r) => r.clientId),
                  e.target.checked,
                )
              }
            />
            Seleccionar los {pendingRows.length} pendientes
          </label>
          <Button variant="accent" disabled={chosen.length === 0} onClick={() => setBatchOpen(true)}>
            Agendar seleccionados{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </Button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title={
            totals.clientsTracked === 0
              ? 'Todavía no hay clientes con plan de servicio. Definí la frecuencia en la ficha de cada cliente.'
              : 'No hay clientes con ese filtro este mes.'
          }
        />
      ) : (
        groups.map(([zoneName, rows]) => {
          const pending = rows.filter((r) => r.status === 'pending');
          const allOn = pending.length > 0 && pending.every((r) => selected.has(r.clientId));
          return (
            <section key={zoneName} aria-label={`Zona ${zoneName}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-4 border-ink pt-2">
                <div className="flex items-baseline gap-3">
                  <h3 className="label-caps !text-ink">{zoneName}</h3>
                  <span className="num text-sm text-muted">
                    {pending.length > 0 ? `${pending.length} por agendar · ` : ''}
                    {rows.length} {rows.length === 1 ? 'cliente' : 'clientes'}
                  </span>
                </div>
                {pending.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-semibold uppercase tracking-wider underline"
                    onClick={() =>
                      toggle(
                        pending.map((r) => r.clientId),
                        !allOn,
                      )
                    }
                  >
                    {allOn ? 'Quitar zona' : 'Elegir zona'}
                  </button>
                ) : null}
              </div>
              <ul>
                {rows.map((row) => (
                  <TrackingItem
                    key={row.clientId}
                    row={row}
                    checked={selected.has(row.clientId)}
                    onToggle={(on) => toggle([row.clientId], on)}
                    onSchedule={() =>
                      open({ type: 'visit', clientId: row.clientId, date: suggested ?? undefined, serviceTypeId: row.serviceTypeId ?? undefined })
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {batchOpen && chosen.length > 0 ? (
        <BatchScheduleSheet
          month={month}
          rows={chosen}
          suggestedDate={suggested}
          onClose={() => setBatchOpen(false)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}

function TrackingItem({
  row,
  checked,
  onToggle,
  onSchedule,
}: {
  row: TrackingRow;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onSchedule: () => void;
}) {
  const pending = row.status === 'pending';
  return (
    <li
      className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-rule border-l-4 py-3 pl-2 ${
        pending ? 'border-l-yellow' : 'border-l-transparent'
      }`}
    >
      {pending ? (
        <input
          type="checkbox"
          aria-label={`Seleccionar ${row.name}`}
          className="size-5 accent-ink"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
      ) : (
        <span aria-hidden />
      )}
      <div className="min-w-0">
        <Link to={`/clientes/${row.clientId}`} className="block truncate text-base font-bold hover:underline">
          {row.name}
        </Link>
        <p className="truncate text-sm text-muted">
          {row.serviceTypeName ?? 'Cualquier servicio'} · {FREQUENCY_LABELS[row.frequency]}
        </p>
        <p className="num text-sm">
          <span className="font-semibold">{STATUS_LABELS[row.status]}</span>
          <span className="text-muted">
            {' · '}
            {row.done} de {row.expected}
            {' · '}
            {row.daysSinceLast === null ? 'sin servicios previos' : `último ${daysAgoLabel(row.daysSinceLast)}`}
            {row.nextScheduled ? ` · próximo ${dayMonth(row.nextScheduled.date)}` : ''}
          </span>
        </p>
      </div>
      <div className="self-center">
        {pending ? (
          <Button size="sm" variant="accent" onClick={onSchedule}>
            Agendar
          </Button>
        ) : null}
      </div>
    </li>
  );
}
