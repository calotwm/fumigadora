import { useId, useState, type FormEvent } from 'react';
import { FREQUENCIES, today, type Frequency } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { DateInput, Input, Select, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useClient, useCreateVisit, useServiceTypes } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, dayMonth } from '../../lib/format';
import type { ClientDetail, ServiceType } from '../../lib/types';
import { SelectedClient } from '../clients/ClientPicker';
import { WithClient } from './WithClient';

export function VisitSheet({ clientId, date, serviceTypeId, onClose }: { clientId?: number; date?: string; serviceTypeId?: number; onClose: () => void }) {
  return (
    <WithClient presetClientId={clientId} title="Nueva visita" onClose={onClose}>
      {(id, change) => <VisitLoader clientId={id} date={date} serviceTypeId={serviceTypeId} onClose={onClose} onChangeClient={change} />}
    </WithClient>
  );
}

function VisitLoader({
  clientId,
  date,
  serviceTypeId,
  onClose,
  onChangeClient,
}: {
  clientId: number;
  date?: string;
  serviceTypeId?: number;
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
    <VisitForm client={client.data} services={services.data} date={date} serviceTypeId={serviceTypeId} onClose={onClose} onChangeClient={onChangeClient} />
  );
}

function VisitForm({
  client,
  services,
  date,
  serviceTypeId: presetServiceTypeId,
  onClose,
  onChangeClient,
}: {
  client: ClientDetail;
  services: ServiceType[];
  date?: string;
  serviceTypeId?: number;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreateVisit();
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>(
    presetServiceTypeId ?? client.defaultServiceTypeId ?? services[0]?.id ?? '',
  );
  const [visitDate, setVisitDate] = useState(date ?? today());
  const [time, setTime] = useState('');
  const [frequency, setFrequency] = useState<Frequency>(
    client.serviceFrequency !== 'none' ? client.serviceFrequency : (client.summary.lastFrequency ?? 'none'),
  );
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
          hint={
            client.serviceFrequency !== 'none'
              ? 'Se sugiere la frecuencia del plan del cliente.'
              : client.summary.lastFrequency
                ? 'Se sugiere la frecuencia de la última visita.'
                : undefined
          }
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
