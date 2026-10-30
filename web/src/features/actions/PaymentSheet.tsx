import { useId, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, today, type DebtByMonth, type PaymentMethod } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, DateInput, MoneyInput, Textarea } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useClientMonths, useCreatePayment, useStatement } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, fullDate, money, monthLabel } from '../../lib/format';
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
  const months = useClientMonths(clientId);
  if (!statement.data || !months.data) {
    const error = statement.error ?? months.error;
    return (
      <Sheet title="Registrar pago" onClose={onClose}>
        {error ? (
          <ErrorNote
            message={errorMessage(error)}
            onRetry={() => {
              void statement.refetch();
              void months.refetch();
            }}
          />
        ) : (
          <Loading />
        )}
      </Sheet>
    );
  }
  return (
    <PaymentForm
      statement={statement.data}
      months={months.data}
      invoiceId={invoiceId}
      onClose={onClose}
      onChangeClient={onChangeClient}
    />
  );
}

function PaymentForm({
  statement,
  months,
  invoiceId,
  onClose,
  onChangeClient,
}: {
  statement: Statement;
  months: DebtByMonth;
  invoiceId?: number;
  onClose: () => void;
  onChangeClient?: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreatePayment();
  const openInvoices = months.months.flatMap((m) => m.invoices);
  const balanceOf = new Map(openInvoices.map((invoice) => [invoice.id, invoice.balanceCents]));
  const balance = statement.summary.balanceCents;
  const initial = invoiceId !== undefined && balanceOf.has(invoiceId) ? [invoiceId] : [];
  const owedBy = (ids: number[]) => ids.reduce((sum, id) => sum + (balanceOf.get(id) ?? 0), 0);

  const [selected, setSelected] = useState<number[]>(initial);
  const [amount, setAmount] = useState<number | null>(initial.length > 0 ? owedBy(initial) : balance > 0 ? balance : null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(today());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedCents = owedBy(selected);
  const target = selected.length > 0 ? selectedCents : balance;
  const exceeds = amount !== null && target > 0 && amount > target;

  /** Changing the selection pre-fills the amount with what the selection owes (or the whole balance). */
  function select(next: number[]) {
    setSelected(next);
    setAmount(next.length > 0 ? owedBy(next) : balance > 0 ? balance : null);
  }

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
        invoiceIds: selected.length > 0 ? selected : undefined,
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
            <p className="text-xs text-muted">
              {selected.length > 0 && selectedCents < balance
                ? 'El importe supera lo elegido; la diferencia se aplica a las facturas más antiguas.'
                : 'El importe supera lo adeudado; la diferencia queda como saldo a favor.'}
            </p>
          ) : null}
        </div>
        <Chips
          label="Medio de pago"
          value={method}
          onChange={setMethod}
          options={PAYMENT_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))}
        />
        <DateInput label="Fecha" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} required />
        {months.months.length > 0 ? <MonthPicker months={months} selected={selected} onChange={select} /> : null}
        <Textarea label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Sheet>
  );
}

/** Owed months with their invoices as checkboxes. A month with one invoice is a single checkbox. */
function MonthPicker({
  months,
  selected,
  onChange,
}: {
  months: DebtByMonth;
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const isOn = (id: number) => selected.includes(id);
  const toggle = (ids: number[], on: boolean) =>
    onChange(on ? [...selected, ...ids.filter((id) => !selected.includes(id))] : selected.filter((id) => !ids.includes(id)));

  return (
    <fieldset className="flex flex-col">
      <legend className="label-caps">Meses a pagar</legend>
      <p className="mt-1 text-xs text-muted">
        Sin selección se aplica a las facturas más antiguas primero. Lo que sobre de los meses elegidos va a las más antiguas.
      </p>
      <ul className="mt-2 border-t border-ink">
        {months.months.map((month) => {
          const ids = month.invoices.map((i) => i.id);
          const all = ids.every(isOn);
          const some = !all && ids.some(isOn);
          const open = month.invoices.reduce((sum, i) => sum + i.balanceCents, 0);
          const single = month.invoices.length === 1 ? month.invoices[0]! : null;
          return (
            <li key={month.month} className="border-b border-rule">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => toggle(ids, e.target.checked)}
                  className="size-5 shrink-0 accent-ink"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{monthLabel(month.month)}</span>
                  <span className="block truncate text-xs text-muted">
                    {single ? `${single.number} · vence ${fullDate(single.dueOn)}` : `${month.invoices.length} facturas`}
                  </span>
                </span>
                <span className="num whitespace-nowrap text-sm font-bold text-red">{money(open)}</span>
              </label>
              {single ? null : (
                <ul className="pb-2 pl-8">
                  {month.invoices.map((invoice) => (
                    <li key={invoice.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                        <input
                          type="checkbox"
                          checked={isOn(invoice.id)}
                          onChange={(e) => toggle([invoice.id], e.target.checked)}
                          className="size-5 shrink-0 accent-ink"
                        />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {invoice.number} · vence {fullDate(invoice.dueOn)}
                          {invoice.description ? ` · ${invoice.description}` : null}
                        </span>
                        <span className="num whitespace-nowrap text-xs font-semibold">{money(invoice.balanceCents)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
