import { useId, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, today, type PaymentMethod } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, DateInput, MoneyInput, Select, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useCreatePayment, useStatement } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, fullDate, money } from '../../lib/format';
import type { Statement } from '../../lib/types';
import { SelectedClient } from '../clients/ClientPicker';
import { WithClient } from './WithClient';

interface PaymentSheetProps {
  clientId?: number;
  invoiceId?: number;
  onClose: () => void;
}

export function PaymentSheet({ clientId, invoiceId, onClose }: PaymentSheetProps) {
  return (
    <WithClient presetClientId={clientId} title="Registrar pago" onClose={onClose}>
      {(id, change) => <PaymentLoader clientId={id} invoiceId={invoiceId} onClose={onClose} onChangeClient={change} />}
    </WithClient>
  );
}

function PaymentLoader({
  clientId,
  invoiceId,
  onClose,
  onChangeClient,
}: {
  clientId: number;
  invoiceId?: number;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const statement = useStatement(clientId);
  if (!statement.data) {
    return (
      <Sheet title="Registrar pago" onClose={onClose}>
        {statement.error ? (
          <ErrorNote message={errorMessage(statement.error)} onRetry={() => statement.refetch()} />
        ) : (
          <Loading />
        )}
      </Sheet>
    );
  }
  return <PaymentForm statement={statement.data} invoiceId={invoiceId} onClose={onClose} onChangeClient={onChangeClient} />;
}

function PaymentForm({
  statement,
  invoiceId,
  onClose,
  onChangeClient,
}: {
  statement: Statement;
  invoiceId?: number;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreatePayment();
  const openInvoices = statement.invoices.filter((invoice) => !invoice.voided && invoice.balanceCents > 0);
  const preselected = openInvoices.find((invoice) => invoice.id === invoiceId) ?? null;
  const balance = statement.summary.balanceCents;

  const [amount, setAmount] = useState<number | null>(
    preselected ? preselected.balanceCents : balance > 0 ? balance : null,
  );
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(today());
  const [notes, setNotes] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<number | ''>(preselected?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const target = selectedInvoice === '' ? balance : (openInvoices.find((i) => i.id === selectedInvoice)?.balanceCents ?? balance);
  const exceeds = amount !== null && target > 0 && amount > target;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || amount <= 0) {
      setError('Ingrese un importe mayor a cero.');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        clientId: statement.client.id,
        amountCents: amount,
        paidOn,
        method,
        notes: notes.trim() || undefined,
        invoiceId: selectedInvoice === '' ? undefined : selectedInvoice,
      },
      {
        onSuccess: (result) => {
          const remaining = result.client.balanceCents;
          toast.success(
            remaining < 0
              ? `Pago registrado. Saldo a favor: ${money(-remaining)}`
              : `Pago registrado. Saldo: ${money(remaining)}`,
          );
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Registrar pago"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button variant="accent" type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Registrando…' : 'Registrar pago'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <SelectedClient name={statement.client.name} onChange={onChangeClient} />
        <div className="flex items-baseline justify-between border-b border-rule pb-2">
          <span className="label-caps">Saldo actual</span>
          <span className={`num text-xl font-extrabold ${balance > 0 ? 'text-red' : ''}`}>{money(balance)}</span>
        </div>
        <div className="flex flex-col gap-2">
          <MoneyInput label="Importe" value={amount} onChange={setAmount} autoFocus error={error} />
          {balance > 0 ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAmount(balance)}>
                Todo el saldo · {money(balance)}
              </Button>
            </div>
          ) : null}
          {exceeds ? (
            <p className="text-xs text-muted">El importe supera lo adeudado; la diferencia queda como saldo a favor.</p>
          ) : null}
        </div>
        <Chips
          label="Medio de pago"
          value={method}
          onChange={setMethod}
          options={PAYMENT_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))}
        />
        <DateInput label="Fecha" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} required />
        {openInvoices.length > 0 ? (
          <Select
            label="Aplicar a"
            value={selectedInvoice}
            onChange={(e) => {
              const value = e.target.value === '' ? '' : Number(e.target.value);
              setSelectedInvoice(value);
              const invoice = openInvoices.find((i) => i.id === value);
              setAmount(invoice ? invoice.balanceCents : balance > 0 ? balance : null);
            }}
            hint="Por defecto se aplica a las facturas más antiguas primero."
          >
            <option value="">Facturas más antiguas primero</option>
            {openInvoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.number} · vence {fullDate(invoice.dueOn)} · {money(invoice.balanceCents)}
              </option>
            ))}
          </Select>
        ) : null}
        <Textarea label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Sheet>
  );
}
