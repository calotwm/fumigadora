import { useId, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, today, type PaymentMethod } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, DateInput, Input, MoneyInput } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useExpenseCategories, useSaveCashEntry } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, money } from '../../lib/format';
import type { ExpenseCategory, Movement } from '../../lib/types';

interface Props {
  kind: 'expense' | 'income';
  /** Existing manual entry (from the movements list) to edit. */
  entry?: Movement;
  onClose: () => void;
}

/** Create or edit a manual cash entry. Expenses need a category; incomes do not. */
export function CashEntrySheet({ kind, entry, onClose }: Props) {
  const categories = useExpenseCategories();
  const title = `${entry ? 'Editar' : 'Registrar'} ${kind === 'expense' ? 'gasto' : 'ingreso'}`;
  if (kind === 'expense' && !categories.data) {
    return (
      <Sheet title={title} onClose={onClose}>
        {categories.error ? <ErrorNote message={errorMessage(categories.error)} /> : <Loading />}
      </Sheet>
    );
  }
  return <CashEntryForm kind={kind} entry={entry} title={title} categories={categories.data ?? []} onClose={onClose} />;
}

function CashEntryForm({
  kind,
  entry,
  title,
  categories,
  onClose,
}: Props & { title: string; categories: ExpenseCategory[] }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useSaveCashEntry();
  const [amount, setAmount] = useState<number | null>(entry?.amountCents ?? null);
  const [categoryId, setCategoryId] = useState<number | null>(entry?.categoryId ?? categories[0]?.id ?? null);
  const [date, setDate] = useState(entry?.date ?? today());
  const [description, setDescription] = useState(entry?.description ?? '');
  const [method, setMethod] = useState<PaymentMethod>(entry?.method ?? 'cash');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || amount <= 0) {
      setError('Ingrese un importe mayor a cero.');
      return;
    }
    if (kind === 'expense' && categoryId === null) {
      setError('Seleccione una categoría.');
      return;
    }
    setError(null);
    mutation.mutate(
      {
        id: entry?.id,
        body: {
          kind,
          amountCents: amount,
          date,
          categoryId: kind === 'expense' ? (categoryId ?? undefined) : undefined,
          description: description.trim() || undefined,
          method,
        },
      },
      {
        onSuccess: () => {
          toast.success(`${kind === 'expense' ? 'Gasto' : 'Ingreso'} ${entry ? 'actualizado' : 'registrado'}: ${money(amount)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <MoneyInput label="Importe" value={amount} onChange={setAmount} autoFocus error={error} />
        {kind === 'expense' ? (
          <Chips
            label="Categoría"
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}
        <DateInput label="Fecha" value={date} required onChange={(e) => setDate(e.target.value)} />
        <Input label="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Chips
          label="Medio de pago"
          value={method}
          onChange={setMethod}
          options={PAYMENT_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))}
        />
      </form>
    </Sheet>
  );
}
