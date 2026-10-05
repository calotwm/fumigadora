import { useId, useState, type FormEvent } from 'react';
import { PAYMENT_METHODS, today, type PaymentMethod } from '@fumigadora/shared';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Chips, DateInput, Input, MoneyInput } from '../../ui/form';
import { ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useCreateExpense, useExpenseCategories } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, money } from '../../lib/format';
import type { ExpenseCategory } from '../../lib/types';

export function ExpenseSheet({ onClose }: { onClose: () => void }) {
  const categories = useExpenseCategories();
  if (!categories.data) {
    return (
      <Sheet title="Registrar gasto" onClose={onClose}>
        {categories.error ? <ErrorNote message={errorMessage(categories.error)} /> : <Loading />}
      </Sheet>
    );
  }
  return <ExpenseForm categories={categories.data} onClose={onClose} />;
}

function ExpenseForm({ categories, onClose }: { categories: ExpenseCategory[]; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const mutation = useCreateExpense();
  const [amount, setAmount] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(categories[0]?.id ?? null);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (amount === null || amount <= 0) {
      setError('Ingrese un importe mayor a cero.');
      return;
    }
    if (categoryId === null) {
      setError('Seleccione una categoría.');
      return;
    }
    setError(null);
    mutation.mutate(
      { kind: 'expense', amountCents: amount, date, categoryId, description: description.trim() || undefined, method },
      {
        onSuccess: () => {
          toast.success(`Gasto registrado: ${money(amount)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Registrar gasto"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending} className="flex-[2]">
            {mutation.isPending ? 'Guardando…' : 'Registrar gasto'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <MoneyInput label="Importe" value={amount} onChange={setAmount} autoFocus error={error} />
        <Chips
          label="Categoría"
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
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
