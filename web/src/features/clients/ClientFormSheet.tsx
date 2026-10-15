import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  CLIENT_KINDS,
  FREQUENCIES,
  IVA_CONDITIONS,
  IVA_CONDITION_LABELS,
  TAX_DOC_TYPES,
  isValidCuit,
  isValidDni,
  type ClientKind,
  type Frequency,
  type IvaCondition,
  type TaxDocType,
} from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Input, MoneyInput, Select, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useArchiveClient, useClient, useSaveClient, useServiceTypes } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, KIND_LABELS, TAX_DOC_LABELS } from '../../lib/format';
import type { ClientDetail, ClientInput } from '../../lib/types';

const EMPTY: ClientInput = {
  name: '',
  kind: 'business',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  area: '',
  notes: '',
  taxId: '',
  monthlyFeeCents: null,
  serviceFrequency: 'none',
  defaultServiceTypeId: null,
  taxDocType: 'none',
  taxDocNumber: '',
  ivaCondition: 'consumidor_final',
  legalName: '',
};

/** Create (no `clientId`) or edit a client. Edit also offers archiving. */
export function ClientFormSheet({
  clientId,
  onClose,
  onSaved,
}: {
  clientId?: number;
  onClose: () => void;
  onSaved?: (id: number) => void;
}) {
  const existing = useClient(clientId ?? null);
  if (clientId !== undefined && !existing.data) {
    return (
      <Sheet title="Editar cliente" onClose={onClose}>
        {existing.error ? <ErrorNote message={errorMessage(existing.error)} /> : <Loading />}
      </Sheet>
    );
  }
  return <ClientForm client={existing.data} onClose={onClose} onSaved={onSaved} />;
}

function toInput(client: ClientDetail): ClientInput {
  return {
    name: client.name,
    kind: client.kind,
    contactName: client.contactName ?? '',
    phone: client.phone ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    area: client.area ?? '',
    notes: client.notes ?? '',
    taxId: client.taxId ?? '',
    monthlyFeeCents: client.monthlyFeeCents,
    serviceFrequency: client.serviceFrequency,
    defaultServiceTypeId: client.defaultServiceTypeId,
    taxDocType: client.taxDocType,
    taxDocNumber: client.taxDocNumber ?? '',
    ivaCondition: client.ivaCondition,
    legalName: client.legalName ?? '',
  };
}

function ClientForm({
  client,
  onClose,
  onSaved,
}: {
  client?: ClientDetail;
  onClose: () => void;
  onSaved?: (id: number) => void;
}) {
  const formId = useId();
  const toast = useToast();
  const navigate = useNavigate();
  const save = useSaveClient();
  const services = useServiceTypes();
  const archive = useArchiveClient();
  const [form, setForm] = useState<ClientInput>(client ? toInput(client) : EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (form.name.trim() === '') {
      setError('El nombre es obligatorio.');
      return;
    }
    if (form.taxDocType === 'cuit' && !isValidCuit(form.taxDocNumber)) {
      setError('El CUIT no es válido: revisá los 11 dígitos.');
      return;
    }
    if (form.taxDocType === 'dni' && !isValidDni(form.taxDocNumber)) {
      setError('El DNI no es válido.');
      return;
    }
    setError(null);
    save.mutate(
      { id: client?.id, input: { ...form, name: form.name.trim() } },
      {
        onSuccess: (saved) => {
          toast.success(client ? 'Cliente actualizado' : `Cliente creado: ${saved.name}`);
          onSaved?.(saved.id);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  if (confirmArchive && client) {
    return (
      <Sheet title="Archivar cliente" onClose={() => setConfirmArchive(false)} variant="modal">
        <p className="text-sm">
          {client.name} dejará de aparecer en listados, búsquedas y facturación de abonos. Podrá restaurarlo más adelante.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-xs text-red">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" onClick={() => setConfirmArchive(false)} className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="accent"
            className="flex-[2]"
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(client.id, {
                onSuccess: () => {
                  toast.success('Cliente archivado');
                  onClose();
                  navigate('/clientes');
                },
                onError: (e) => setError(errorMessage(e)),
              })
            }
          >
            Archivar
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={client ? 'Editar cliente' : 'Nuevo cliente'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          {client ? (
            <Button variant="outline" onClick={() => setConfirmArchive(true)}>
              Archivar
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending} className="flex-[2]">
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Input
          label="Nombre"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
          data-autofocus
          error={error}
        />
        <Select label="Tipo" value={form.kind} onChange={(e) => set('kind', e.target.value as ClientKind)}>
          {CLIENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Contacto" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
          <Input label="Teléfono" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <Input label="Correo electrónico" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Dirección" value={form.address} onChange={(e) => set('address', e.target.value)} />
          <Input label="Zona" value={form.area} onChange={(e) => set('area', e.target.value)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Frecuencia del servicio"
            value={form.serviceFrequency}
            onChange={(e) => set('serviceFrequency', e.target.value as Frequency)}
            hint="Con un plan, el cliente aparece en el seguimiento mensual."
          >
            {FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {value === 'none' ? 'Sin plan' : FREQUENCY_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            label="Servicio habitual"
            value={form.defaultServiceTypeId ?? ''}
            onChange={(e) => set('defaultServiceTypeId', e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Sin servicio habitual</option>
            {(services.data ?? []).map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <MoneyInput
            label="Abono mensual"
            value={form.monthlyFeeCents}
            onChange={(cents) => set('monthlyFeeCents', cents)}
            hint="Opcional. Se usa para la facturación mensual."
          />
        </div>
        <fieldset className="flex flex-col gap-4 border-t border-rule pt-4">
          <legend className="label-caps !text-ink">Datos fiscales</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Condición frente al IVA"
              value={form.ivaCondition}
              onChange={(e) => set('ivaCondition', e.target.value as IvaCondition)}
            >
              {IVA_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {IVA_CONDITION_LABELS[value]}
                </option>
              ))}
            </Select>
            <Input label="Razón social" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Documento"
              value={form.taxDocType}
              onChange={(e) => set('taxDocType', e.target.value as TaxDocType)}
              hint="Se usa para la factura electrónica."
            >
              {TAX_DOC_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TAX_DOC_LABELS[value]}
                </option>
              ))}
            </Select>
            {form.taxDocType !== 'none' ? (
              <Input
                label={form.taxDocType === 'cuit' ? 'CUIT' : 'DNI'}
                inputMode="numeric"
                value={form.taxDocNumber}
                onChange={(e) => set('taxDocNumber', e.target.value)}
                placeholder={form.taxDocType === 'cuit' ? '20-12345678-6' : '30123456'}
              />
            ) : null}
          </div>
        </fieldset>
        <Textarea label="Notas" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Sheet>
  );
}
