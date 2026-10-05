import { useId, useState, type FormEvent } from 'react';
import { FREQUENCIES, nextVisitDate, today, type Frequency } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Checkbox, DateInput, Input, MoneyInput, Select, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useClient, useCompleteVisit, useCreateVisit, useServiceTypes } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, dayMonth, fullDate, money } from '../../lib/format';
import type { ClientDetail, ServiceType, Visit } from '../../lib/types';
import { SelectedClient } from '../clients/ClientPicker';
import { WithClient } from './WithClient';

export function VisitSheet({ clientId, date, onClose }: { clientId?: number; date?: string; onClose: () => void }) {
  return (
    <WithClient presetClientId={clientId} title="Nueva visita" onClose={onClose}>
      {(id, change) => <VisitLoader clientId={id} date={date} onClose={onClose} onChangeClient={change} />}
    </WithClient>
  );
}

function VisitLoader({
  clientId,
  date,
  onClose,
  onChangeClient,
}: {
  clientId: number;
  date?: string;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const client = useClient(clientId);
  const services = useServiceTypes();
  const failure = client.error ?? services.error;
  if (!client.data || !services.data) {
    return (
      <Sheet title="Nueva visita" onClose={onClose}>
        {failure ? <ErrorNote message={errorMessage(failure)} /> : <Loading />}
      </Sheet>
    );
  }
  return (
    <VisitForm client={client.data} services={services.data} date={date} onClose={onClose} onChangeClient={onChangeClient} />
  );
}

function VisitForm({
  client,
  services,
  date,
  onClose,
  onChangeClient,
}: {
  client: ClientDetail;
  services: ServiceType[];
  date?: string;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreateVisit();
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>(services[0]?.id ?? '');
  const [visitDate, setVisitDate] = useState(date ?? today());
  const [time, setTime] = useState('');
  const [frequency, setFrequency] = useState<Frequency>(client.summary.lastFrequency ?? 'none');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (serviceTypeId === '') {
      setError('Seleccione un tipo de servicio.');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        clientId: client.id,
        serviceTypeId,
        date: visitDate,
        time: time || undefined,
        frequency,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (visit) => {
          toast.success(`Visita agendada para el ${dayMonth(visit.date)}${visit.time ? ` a las ${visit.time}` : ''}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Nueva visita"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Agendando…' : 'Agendar visita'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <SelectedClient name={client.name} onChange={onChangeClient} />
        <Select
          label="Servicio"
          value={serviceTypeId}
          onChange={(e) => setServiceTypeId(Number(e.target.value))}
          error={error}
          data-autofocus
        >
          {services.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <DateInput label="Fecha" value={visitDate} required onChange={(e) => setVisitDate(e.target.value)} />
          <Input label="Hora (opcional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <Select
          label="Frecuencia"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          hint={client.summary.lastFrequency ? 'Se sugiere la frecuencia de la última visita.' : undefined}
        >
          {FREQUENCIES.map((value) => (
            <option key={value} value={value}>
              {FREQUENCY_LABELS[value]}
            </option>
          ))}
        </Select>
        <Textarea label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Sheet>
  );
}

/** Confirms a visit as done. T5 refines this (price, certificate number, next date). */
export function CompleteVisitSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const services = useServiceTypes();
  if (!services.data) {
    return (
      <Sheet title="Completar visita" onClose={onClose} variant="modal">
        {services.error ? <ErrorNote message={errorMessage(services.error)} /> : <Loading />}
      </Sheet>
    );
  }
  const defaultPrice = services.data.find((s) => s.id === visit.serviceTypeId)?.defaultPriceCents ?? 0;
  return <CompleteVisitForm visit={visit} defaultPrice={defaultPrice} onClose={onClose} />;
}

function CompleteVisitForm({ visit, defaultPrice, onClose }: { visit: Visit; defaultPrice: number; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCompleteVisit();
  const initialPrice = visit.priceCents ?? defaultPrice;
  const [price, setPrice] = useState<number | null>(initialPrice > 0 ? initialPrice : null);
  const [createInvoice, setCreateInvoice] = useState(initialPrice > 0);
  const [issueCertificate, setIssueCertificate] = useState(visit.issuesCertificate);
  const hasFrequency = visit.frequency !== 'none';
  const [scheduleNext, setScheduleNext] = useState(hasFrequency);
  const [error, setError] = useState<string | null>(null);
  const next = hasFrequency ? nextVisitDate(today(), visit.frequency) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (createInvoice && (price === null || price <= 0)) {
      setError('Ingrese el importe a facturar o desmarque la factura.');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        id: visit.id,
        body: {
          priceCents: price ?? undefined,
          createInvoice,
          issueCertificate,
          scheduleNext,
        },
      },
      {
        onSuccess: (result) => {
          const parts = ['Visita completada'];
          if (result.invoice) parts.push(`factura ${result.invoice.number}`);
          if (result.certificate) parts.push(`oblea ${result.certificate.number}`);
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
      variant="modal"
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Guardando…' : 'Completar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        <div className="border-l-4 border-ink bg-paper-2 px-3 py-2">
          <p className="text-base font-bold">{visit.clientName}</p>
          <p className="text-sm text-muted">
            {visit.serviceTypeName} · {fullDate(visit.date)}
            {visit.time ? ` · ${visit.time}` : ''}
          </p>
        </div>
        <Checkbox
          label="Crear factura"
          hint={price ? money(price) : 'Sin importe definido'}
          checked={createInvoice}
          onChange={setCreateInvoice}
        />
        {createInvoice ? <MoneyInput label="Importe a facturar" value={price} onChange={setPrice} error={error} /> : null}
        {visit.issuesCertificate ? (
          <Checkbox label="Emitir oblea" hint="Número y vencimiento automáticos" checked={issueCertificate} onChange={setIssueCertificate} />
        ) : null}
        {hasFrequency ? (
          <Checkbox
            label="Agendar próxima visita"
            hint={`${FREQUENCY_LABELS[visit.frequency]}${next ? ` · ${fullDate(next)}` : ''}`}
            checked={scheduleNext}
            onChange={setScheduleNext}
          />
        ) : null}
        {!createInvoice && error ? (
          <p role="alert" className="text-xs text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
