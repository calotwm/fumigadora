import { useId, useState, type FormEvent } from 'react';
import { EMPLOYEE_PAY_KINDS, PAYMENT_METHODS, today, type EmployeePayKind, type PaymentMethod } from '@fumigadora/shared';
import { useCreateEmployeePay, useDeleteEmployeePay, useEmployeePay, useUsers } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, fullDate, money } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading, SectionHead, Stat, Table } from '../../ui/display';
import { Chips, DateInput, Input, MoneyInput } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import type { EmployeePayItem, EmployeePayMonth } from '../../lib/types';

export const PAY_KIND_LABELS: Record<EmployeePayKind, string> = { sueldo: 'Sueldo', adelanto: 'Adelanto', otro: 'Otro' };

/** Payments made to each employee in a month, next to the cash they collected and handed over. */
export function EmployeePayPanel({ month }: { month: string }) {
  const { data, error, isLoading, refetch } = useEmployeePay(month);
  const [adding, setAdding] = useState(false);
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />;
  return (
    <>
      <PayView data={data} onAdd={() => setAdding(true)} />
      {adding ? <EmployeePaySheet onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function PayView({ data, onAdd }: { data: EmployeePayMonth; onAdd: () => void }) {
  const remove = useDeleteEmployeePay();
  const toast = useToast();
  const [deleting, setDeleting] = useState<EmployeePayItem | null>(null);
  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Total pagado a empleados" className="section-head">
        <div className="flex flex-wrap items-end justify-between gap-4 pt-3">
          <Stat label="Pagado a empleados" value={money(data.totalPaidCents)} note="Cuenta como gasto (categoría Sueldos)" />
          <Button onClick={onAdd}>Registrar pago</Button>
        </div>
      </section>

      <section aria-label="Por empleado">
        <SectionHead title="Por empleado" />
        {data.employees.length === 0 ? (
          <EmptyState title="No hay empleados." />
        ) : (
          <Table
            caption="Pagos y efectivo por empleado"
            rows={data.employees}
            rowKey={(e) => e.userId}
            gridClass="md:grid-cols-[2fr_1fr_1fr_1fr_1fr]"
            columns={[
              { key: 'name', header: 'Empleado', primary: true, cell: (e) => <span className="font-bold">{e.name}</span> },
              {
                key: 'paid',
                header: 'Pagado',
                align: 'right',
                cell: (e) => (
                  <span className="num font-bold" title={`Sueldo ${money(e.byKind.sueldo)} · Adelantos ${money(e.byKind.adelanto)} · Otros ${money(e.byKind.otro)}`}>
                    {money(e.paidCents)}
                  </span>
                ),
              },
              { key: 'collected', header: 'Efectivo cobrado', align: 'right', cell: (e) => <span className="num">{money(e.cashCollectedCents)}</span> },
              { key: 'handed', header: 'Rendido', align: 'right', cell: (e) => <span className="num">{money(e.cashHandedOverCents)}</span> },
              {
                key: 'pending',
                header: 'A rendir',
                align: 'right',
                cell: (e) => <span className={`num ${e.cashPendingCents > 0 ? 'font-bold text-red' : ''}`}>{money(e.cashPendingCents)}</span>,
              },
            ]}
          />
        )}
      </section>

      <section aria-label="Pagos del mes">
        <SectionHead title="Pagos del mes" />
        {data.payments.length === 0 ? (
          <EmptyState title="No hay pagos a empleados en este mes." />
        ) : (
          <ul className="border-t border-ink">
            {data.payments.map((p) => (
              <li key={p.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-x-3 border-b border-rule py-3">
                <span className="num text-sm font-semibold">{fullDate(p.date).slice(0, 5)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{p.userName}</p>
                  <p className="truncate text-xs text-muted">
                    {PAY_KIND_LABELS[p.kind]} · {METHOD_LABELS[p.method]}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num whitespace-nowrap font-extrabold">{money(p.amountCents)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(p)} aria-label={`Eliminar pago a ${p.userName}`}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {deleting ? (
        <Confirm
          title="Eliminar pago"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Pago eliminado');
          }}
        >
          <p>
            Se eliminará el pago de <strong className="num">{money(deleting.amountCents)}</strong> a {deleting.userName} del {fullDate(deleting.date)}.
          </p>
        </Confirm>
      ) : null}
    </div>
  );
}

function EmployeePaySheet({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const users = useUsers();
  const create = useCreateEmployeePay();
  const staff = (users.data ?? []).filter((u) => u.active);
  const [userId, setUserId] = useState<number | null>(null);
  const [kind, setKind] = useState<EmployeePayKind>('sueldo');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState<string | null>(null);
  const chosen = userId ?? staff.find((u) => u.role === 'employee')?.id ?? staff[0]?.id ?? null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen === null) return setError('Elegí un empleado.');
    if (amount === null || amount <= 0) return setError('Ingrese un importe mayor a cero.');
    setError(null);
    create.mutate(
      { userId: chosen, kind, amountCents: amount, date, method, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(`Pago registrado: ${money(amount)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Registrar pago a empleado"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={create.isPending} className="flex-[2]">
            {create.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      {users.isLoading ? (
        <Loading />
      ) : (
        <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
          <Chips label="Empleado" value={chosen} onChange={setUserId} options={staff.map((u) => ({ value: u.id, label: u.name }))} />
          <Chips label="Tipo" value={kind} onChange={setKind} options={EMPLOYEE_PAY_KINDS.map((k) => ({ value: k, label: PAY_KIND_LABELS[k] }))} />
          <MoneyInput label="Importe" value={amount} onChange={setAmount} error={error} />
          <DateInput label="Fecha" value={date} required onChange={(e) => setDate(e.target.value)} />
          <Input label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Chips
            label="Medio de pago"
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))}
          />
        </form>
      )}
    </Sheet>
  );
}
