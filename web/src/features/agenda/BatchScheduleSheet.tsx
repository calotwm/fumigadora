import { useId, useState, type FormEvent } from 'react';
import { monthLabelEs, monthRange } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { DateInput, Input, Select } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { useScheduleTracking, useServiceTypes } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS } from '../../lib/format';
import type { TrackingRow } from '../../lib/types';
import { AssigneeSelect } from '../employees/AssigneeSelect';

interface Draft {
  date: string;
  time: string;
  serviceTypeId: number | '';
  assignee: number | '';
}

/** Confirms the dates of several pending clients and schedules them all in one request. */
export function BatchScheduleSheet({
  month,
  rows,
  suggestedDate,
  onClose,
  onDone,
}: {
  month: string;
  rows: TrackingRow[];
  suggestedDate: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const schedule = useScheduleTracking();
  const services = useServiceTypes();
  const { from, to } = monthRange(month);
  const initialDate = suggestedDate ?? to;
  const [allDate, setAllDate] = useState(initialDate);
  const [allTime, setAllTime] = useState('');
  const [allAssignee, setAllAssignee] = useState<number | ''>('');
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.clientId, { date: initialDate, time: '', serviceTypeId: r.serviceTypeId ?? '', assignee: '' as const }])),
  );
  const [error, setError] = useState<string | null>(null);

  function patch(clientId: number, change: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [clientId]: { ...current[clientId]!, ...change } }));
  }
  function applyAll(change: Partial<Draft>) {
    setDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, d]) => [id, { ...d, ...change }])));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const missing = rows.find((r) => drafts[r.clientId]?.serviceTypeId === '');
    if (missing) {
      setError(`Elegí el servicio para ${missing.name}.`);
      return;
    }
    setError(null);
    schedule.mutate(
      {
        month,
        items: rows.map((r) => {
          const d = drafts[r.clientId]!;
          return {
            clientId: r.clientId,
            date: d.date,
            time: d.time || undefined,
            serviceTypeId: r.serviceTypeId === null ? Number(d.serviceTypeId) : undefined,
            assignedUserId: d.assignee === '' ? undefined : d.assignee,
          };
        }),
      },
      {
        onSuccess: ({ created }) => {
          toast.success(created.length === 1 ? 'Visita agendada' : `${created.length} visitas agendadas`);
          onDone();
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Agendar seleccionados"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="accent" disabled={schedule.isPending} className="flex-[2]">
            {schedule.isPending ? 'Agendando…' : `Agendar ${rows.length} ${rows.length === 1 ? 'visita' : 'visitas'}`}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <p className="text-sm text-muted">
          Servicios pendientes de {monthLabelEs(month)}. Elegí una fecha para todos y ajustala por cliente si hace falta.
        </p>
        <div className="grid grid-cols-2 gap-4 border-b border-rule pb-5">
          <DateInput
            label="Fecha para todos"
            value={allDate}
            min={from}
            max={to}
            onChange={(e) => {
              setAllDate(e.target.value);
              if (e.target.value) applyAll({ date: e.target.value });
            }}
          />
          <Input
            label="Hora (opcional)"
            type="time"
            value={allTime}
            onChange={(e) => {
              setAllTime(e.target.value);
              applyAll({ time: e.target.value });
            }}
          />
        </div>
        <AssigneeSelect
          label="Asignar a todos"
          value={allAssignee}
          onChange={(value) => {
            setAllAssignee(value);
            applyAll({ assignee: value });
          }}
        />
        <ul className="flex flex-col gap-4">
          {rows.map((r) => {
            const d = drafts[r.clientId]!;
            return (
              <li key={r.clientId} className="border-l-4 border-yellow pl-3">
                <p className="font-bold">{r.name}</p>
                <p className="mb-2 text-xs text-muted">
                  {r.serviceTypeName ?? 'Sin servicio habitual'} · {FREQUENCY_LABELS[r.frequency]}
                  {r.zone ? ` · ${r.zone}` : ''}
                </p>
                {r.serviceTypeId === null ? (
                  <Select
                    label="Servicio"
                    value={d.serviceTypeId}
                    onChange={(e) => patch(r.clientId, { serviceTypeId: e.target.value === '' ? '' : Number(e.target.value) })}
                    wrapperClassName="mb-3"
                  >
                    <option value="">Elegí un servicio</option>
                    {(services.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <DateInput
                    label="Fecha"
                    value={d.date}
                    min={from}
                    max={to}
                    required
                    onChange={(e) => patch(r.clientId, { date: e.target.value })}
                  />
                  <Input label="Hora" type="time" value={d.time} onChange={(e) => patch(r.clientId, { time: e.target.value })} />
                </div>
                <AssigneeSelect
                  wrapperClassName="mt-3"
                  value={d.assignee}
                  onChange={(value) => patch(r.clientId, { assignee: value })}
                />
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="text-xs text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
