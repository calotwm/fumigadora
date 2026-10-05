import { useState } from 'react';
import { Link } from 'react-router';
import { addMonths, startOfMonth, today } from '@fumigadora/shared';
import { useDeletePayment, usePayments } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, fullDate, money } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { Select } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, Table, type Column } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import type { PaymentWithClient } from '../../lib/types';

const RANGES = [
  { value: '0', label: 'Este mes' },
  { value: '2', label: 'Últimos 3 meses' },
  { value: 'all', label: 'Todos' },
];

export function PaymentsTab() {
  const [range, setRange] = useState('0');
  const [deleting, setDeleting] = useState<PaymentWithClient | null>(null);
  const toast = useToast();
  const remove = useDeletePayment();
  const from = range === 'all' ? undefined : startOfMonth(addMonths(startOfMonth(today()), -Number(range)));
  const { data, error, isLoading, refetch } = usePayments(from);

  const columns: Column<PaymentWithClient>[] = [
    {
      key: 'client',
      header: 'Cliente',
      primary: true,
      cell: (p) => (
        <Link to={`/clientes/${p.clientId}`} className="text-base font-bold hover:underline">
          {p.clientName}
        </Link>
      ),
    },
    { key: 'date', header: 'Fecha', cell: (p) => <span className="num">{fullDate(p.paidOn)}</span> },
    { key: 'method', header: 'Medio', cell: (p) => METHOD_LABELS[p.method] },
    {
      key: 'applied',
      header: 'Aplicado a',
      cell: (p) => (
        <span className="text-xs">
          {p.allocations.map((a) => a.invoiceNumber).join(', ') || '—'}
          {p.unallocatedCents > 0 ? <span className="block text-muted">A favor: {money(p.unallocatedCents)}</span> : null}
        </span>
      ),
    },
    { key: 'amount', header: 'Importe', align: 'right', cell: (p) => <span className="num font-bold">{money(p.amountCents)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      wide: true,
      cell: (p) => (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
          Eliminar
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 max-w-xs">
        <Select label="Período" value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data && data.length > 0 ? (
        <>
          <p className="mb-2 text-sm text-muted">
            {data.length} pagos · <span className="num font-semibold text-ink">{money(data.reduce((sum, p) => sum + p.amountCents, 0))}</span>
          </p>
          <Table
            caption="Pagos"
            columns={columns}
            rows={data}
            rowKey={(p) => p.id}
            gridClass="md:grid-cols-[minmax(0,2fr)_90px_1fr_1.2fr_1fr_100px]"
          />
        </>
      ) : (
        <EmptyState title="No hay pagos en este período." />
      )}
      {deleting ? (
        <Confirm
          title="Eliminar pago"
          confirmLabel="Eliminar pago"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Pago eliminado. Las facturas se reabrieron.');
          }}
        >
          <p>
            Se eliminará el pago de <strong>{deleting.clientName}</strong> por <strong className="num">{money(deleting.amountCents)}</strong> del{' '}
            {fullDate(deleting.paidOn)}.
          </p>
          <p className="text-muted">Las facturas que cubría volverán a quedar pendientes y el saldo del cliente aumentará.</p>
        </Confirm>
      ) : null}
    </>
  );
}
