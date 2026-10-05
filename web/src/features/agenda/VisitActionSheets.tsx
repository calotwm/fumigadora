import { useId, useState, type FormEvent } from 'react';
import { addDays, nextVisitDate, today } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Checkbox, DateInput, Input, MoneyInput, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useCancelVisit, useCompleteVisit, useRescheduleVisit, useServiceTypes } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, dayMonth, fullDate, money } from '../../lib/format';
import type { ServiceType, Visit } from '../../lib/types';

function VisitSummary({ visit }: { visit: Visit }) {
  return (
    <div className="border-l-4 border-ink bg-paper-2 px-3 py-2">
      <p className="text-base font-bold">{visit.clientName}</p>
      <p className="text-sm text-muted">
        {visit.serviceTypeName} · {fullDate(visit.date)}
        {visit.time ? ` · ${visit.time}` : ''}
      </p>
    </div>
  );
}

export function CompleteVisitSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const services = useServiceTypes();
  if (!services.data) {
    return (
      <Sheet title="Completar visita" onClose={onClose}>
        {services.error ? <ErrorNote message={errorMessage(services.error)} /> : <Loading />}
      </Sheet>
    );
  }
  const service = services.data.find((s) => s.id === visit.serviceTypeId);
  return <CompleteVisitForm visit={visit} service={service} onClose={onClose} />;
}

function CompleteVisitForm({ visit, service, onClose }: { visit: Visit; service: ServiceType | undefined; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCompleteVisit();
  const initialPrice = visit.priceCents ?? service?.defaultPriceCents ?? 0;
  const hasFrequency = visit.frequency !== 'none';

  const [completedOn, setCompletedOn] = useState(visit.date <= today() ? visit.date : today());
  const [price, setPrice] = useState<number | null>(initialPrice > 0 ? initialPrice : null);
  const [createInvoice, setCreateInvoice] = useState(initialPrice > 0);
  const [issueCertificate, setIssueCertificate] = useState(visit.issuesCertificate);
  const [certificateNumber, setCertificateNumber] = useState('');
  const [scheduleNext, setScheduleNext] = useState(hasFrequency);
  const [nextDate, setNextDate] = useState(hasFrequency ? (nextVisitDate(completedOn, visit.frequency) ?? '') : '');
  const [nextDateTouched, setNextDateTouched] = useState(false);
  const [nextTime, setNextTime] = useState(visit.time ?? '');
  const [notes, setNotes] = useState(visit.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const validity = service?.certificateValidityDays ?? null;
  const expiry = validity ? addDays(completedOn, validity) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (createInvoice && (price === null || price <= 0)) {
      setError('Ingrese el importe a facturar o desmarque la factura.');
      return;
    }
    if (scheduleNext && (!nextDate || nextDate <= completedOn)) {
      setError('La próxima visita debe ser posterior a la fecha de realización.');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        id: visit.id,
        body: {
          completedOn,
          priceCents: price ?? undefined,
          createInvoice,
          issueCertificate: visit.issuesCertificate && issueCertificate,
          certificateNumber: issueCertificate && certificateNumber.trim() ? certificateNumber.trim() : undefined,
          scheduleNext,
          nextDate: scheduleNext ? nextDate : undefined,
          nextTime: scheduleNext ? nextTime || null : undefined,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (result) => {
          const parts = ['Visita completada'];
          if (result.invoice) parts.push(`factura ${result.invoice.number} por ${money(result.invoice.amountCents)}`);
          if (result.certificate) parts.push(`oblea ${result.certificate.number} (vence ${fullDate(result.certificate.expiresOn)})`);
          if (result.nextVisit) parts.push(`próxima visita ${dayMonth(result.nextVisit.date)}`);
          toast.success(parts.join(' · '));
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Completar visita"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Guardando…' : 'Confirmar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <VisitSummary visit={visit} />
        <DateInput
          label="Fecha de realización"
          value={completedOn}
          max={today()}
          required
          onChange={(e) => {
            setCompletedOn(e.target.value);
            if (!nextDateTouched && hasFrequency && e.target.value) setNextDate(nextVisitDate(e.target.value, visit.frequency) ?? '');
          }}
        />
        <div className="flex flex-col gap-2 border-t border-rule pt-3">
          <Checkbox label="Crear factura" hint={price ? money(price) : 'Sin importe definido'} checked={createInvoice} onChange={setCreateInvoice} />
          {createInvoice ? <MoneyInput label="Importe a facturar" value={price} onChange={setPrice} /> : null}
        </div>
        {visit.issuesCertificate ? (
          <div className="flex flex-col gap-2 border-t border-rule pt-3">
            <Checkbox
              label="Emitir oblea"
              hint={expiry ? `Vence el ${fullDate(expiry)} (${validity} días)` : 'Número y vencimiento automáticos'}
              checked={issueCertificate}
              onChange={setIssueCertificate}
            />
            {issueCertificate ? (
              <Input
                label="Número de oblea (opcional)"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
                hint="Si lo deja vacío se asigna el siguiente número."
              />
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 border-t border-rule pt-3">
          <Checkbox
            label="Agendar próxima visita"
            hint={hasFrequency ? FREQUENCY_LABELS[visit.frequency] : 'Sin frecuencia: elija la fecha'}
            checked={scheduleNext}
            onChange={setScheduleNext}
          />
          {scheduleNext ? (
            <div className="grid grid-cols-2 gap-4">
              <DateInput
                label="Fecha"
                value={nextDate}
                min={addDays(completedOn, 1)}
                required
                onChange={(e) => {
                  setNextDate(e.target.value);
                  setNextDateTouched(true);
                }}
              />
              <Input label="Hora" type="time" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
            </div>
          ) : null}
        </div>
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

export function RescheduleVisitSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useRescheduleVisit();
  const [date, setDate] = useState(visit.date);
  const [time, setTime] = useState(visit.time ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    mutation.mutate(
      { id: visit.id, date, time: time || null },
      {
        onSuccess: (updated) => {
          toast.success(`Visita reprogramada para el ${dayMonth(updated.date)}${updated.time ? ` a las ${updated.time}` : ''}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Reprogramar visita"
      onClose={onClose}
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            Reprogramar
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <VisitSummary visit={visit} />
        <div className="grid grid-cols-2 gap-4">
          <DateInput label="Nueva fecha" value={date} required onChange={(e) => setDate(e.target.value)} error={error} />
          <Input label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </form>
    </Sheet>
  );
}

export function CancelVisitSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const toast = useToast();
  const mutation = useCancelVisit();
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Cancelar visita" onClose={onClose} variant="modal">
      <div className="flex flex-col gap-4">
        <VisitSummary visit={visit} />
        <p className="text-sm">La visita quedará marcada como cancelada y dejará de aparecer en la agenda.</p>
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Volver
          </Button>
          <Button
            variant="accent"
            className="flex-[2]"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate(visit.id, {
                onSuccess: () => {
                  toast.success('Visita cancelada');
                  onClose();
                },
                onError: (e) => setError(errorMessage(e)),
              })
            }
          >
            Cancelar visita
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
