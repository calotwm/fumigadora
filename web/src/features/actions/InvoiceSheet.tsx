import { useId, useState, type FormEvent } from 'react';
import { addDays, today } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { DateInput, Input, MoneyInput } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useClient, useCreateInvoice } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import type { ClientDetail } from '../../lib/types';
import { SelectedClient } from '../clients/ClientPicker';
import { WithClient } from './WithClient';

export function InvoiceSheet({ clientId, onClose }: { clientId?: number; onClose: () => void }) {
  return (
    <WithClient presetClientId={clientId} title="Nueva factura" onClose={onClose}>
      {(id, change) => <InvoiceLoader clientId={id} onClose={onClose} onChangeClient={change} />}
    </WithClient>
  );
}

function InvoiceLoader({
  clientId,
  onClose,
  onChangeClient,
}: {
  clientId: number;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const client = useClient(clientId);
  if (!client.data) {
    return (
      <Sheet title="Nueva factura" onClose={onClose}>
        {client.error ? <ErrorNote message={errorMessage(client.error)} onRetry={() => client.refetch()} /> : <Loading />}
      </Sheet>
    );
  }
  return <InvoiceForm client={client.data} onClose={onClose} onChangeClient={onChangeClient} />;
}

function InvoiceForm({
  client,
  onClose,
  onChangeClient,
}: {
  client: ClientDetail;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreateInvoice();
  const [amount, setAmount] = useState<number | null>(client.monthlyFeeCents);
  const [issuedOn, setIssuedOn] = useState(today());
  const [dueOn, setDueOn] = useState(addDays(today(), 10));
  const [dueTouched, setDueTouched] = useState(false);
  const [description, setDescription] = useState(client.monthlyFeeCents ? 'Abono mensual' : '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || amount <= 0) {
      setError('Ingrese un importe mayor a cero.');
      return;
    }
    if (dueOn < issuedOn) {
      setError('El vencimiento no puede ser anterior a la emisión.');
      return;
    }
    setError(null);
    mutation.mutate(
      { clientId: client.id, amountCents: amount, issuedOn, dueOn, description: description.trim() || undefined },
      {
        onSuccess: (invoice) => {
          toast.success(`Factura ${invoice.number} creada por ${money(invoice.amountCents)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Nueva factura"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Creando…' : 'Crear factura'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <SelectedClient name={client.name} onChange={onChangeClient} />
        <MoneyInput
          label="Importe"
          value={amount}
          onChange={setAmount}
          autoFocus
          error={error}
          hint={client.monthlyFeeCents ? `Abono mensual: ${money(client.monthlyFeeCents)}` : undefined}
        />
        <div className="grid grid-cols-2 gap-4">
          <DateInput
            label="Emisión"
            value={issuedOn}
            required
            onChange={(e) => {
              setIssuedOn(e.target.value);
              if (!dueTouched && e.target.value) setDueOn(addDays(e.target.value, 10));
            }}
          />
          <DateInput
            label="Vencimiento"
            value={dueOn}
            required
            onChange={(e) => {
              setDueOn(e.target.value);
              setDueTouched(true);
            }}
          />
        </div>
        <Input label="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle del servicio" />
      </form>
    </Sheet>
  );
}
