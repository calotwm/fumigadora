import { useId, useState, type FormEvent } from 'react';
import { nextWorkingDay, today as todayIso } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, DateInput, Input, Textarea } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { useCancelMyVisit, usePostponeMyVisit } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { dayMonth } from '../../lib/format';
import type { MyVisit } from '../../lib/types';

/** "El cliente canceló": the employee either moves the visit to another day (default: next Mon-Sat) or cancels it with a reason. */
export function ClientCancelledSheet({ visit, onClose }: { visit: MyVisit; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const postpone = usePostponeMyVisit();
  const cancel = useCancelMyVisit();
  const today = todayIso();
  const [action, setAction] = useState<'postpone' | 'cancel'>('postpone');
  const [date, setDate] = useState(nextWorkingDay(visit.date > today ? visit.date : today));
  const [time, setTime] = useState(visit.time ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = postpone.isPending || cancel.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (action === 'postpone') {
      if (!date || date < today) return setError('Elegí una fecha desde hoy.');
      setError(null);
      postpone.mutate(
        { id: visit.id, date, time: time || null },
        {
          onSuccess: () => {
            toast.success(`Visita pospuesta para el ${dayMonth(date)}${time ? ` a las ${time}` : ''}`);
            onClose();
          },
          onError: (e) => setError(errorMessage(e)),
        },
      );
      return;
    }
    if (!reason.trim()) return setError('Escribí el motivo de la cancelación.');
    setError(null);
    cancel.mutate(
      { id: visit.id, reason: reason.trim() },
      {
        onSuccess: (result) => {
          toast.success(result.nextVisit ? `Visita cancelada · próxima el ${dayMonth(result.nextVisit.date)}` : 'Visita cancelada');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="El cliente canceló"
      onClose={onClose}
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Volver
          </Button>
          <Button type="submit" form={formId} variant="accent" disabled={pending} className="min-h-14 flex-[2] text-base">
            {pending ? 'Guardando…' : action === 'postpone' ? 'Posponer' : 'Cancelar visita'}
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
          label="¿Qué hacemos con la visita?"
          value={action}
          onChange={setAction}
          options={[
            { value: 'postpone', label: 'Posponer' },
            { value: 'cancel', label: 'Cancelar' },
          ]}
        />
        {action === 'postpone' ? (
          <div className="grid grid-cols-2 gap-4">
            <DateInput label="Nueva fecha" value={date} min={today} required onChange={(e) => setDate(e.target.value)} />
            <Input label="Hora (opcional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        ) : (
          <Textarea label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
        )}
        {action === 'cancel' && visit.frequency !== 'none' ? (
          <p className="text-xs text-muted">Es un servicio periódico: se agenda la próxima visita automáticamente.</p>
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
