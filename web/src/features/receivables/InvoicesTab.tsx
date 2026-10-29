import { useState } from 'react';
import { Link } from 'react-router';
import { useInvoices, useVoidInvoice } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { dayMonth, money, overdueLabel } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { Chips } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, Table, Tag, type Column } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useActions } from '../actions/ActionsProvider';
import { InvoiceLines } from './InvoiceLines';
import { ArcaState, EmitButton } from './Arca';
import type { InvoiceWithClient } from '../../lib/types';

const FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'partial', label: 'Parciales' },
  { value: 'paid', label: 'Pagadas' },
  { value: 'void', label: 'Anuladas' },
];

export function InvoicesTab() {
  const [status, setStatus] = useState('');
  const [voiding, setVoiding] = useState<InvoiceWithClient | null>(null);
  const { open } = useActions();
  const toast = useToast();
  const voidMutation = useVoidInvoice();
  const { data, error, isLoading, refetch } = useInvoices(status);

  const columns: Column<InvoiceWithClient>[] = [
    {
      key: 'number',
      header: 'Factura',
      primary: true,
      cell: (i) => (
        <div className="min-w-0">
          <p className="num font-bold">{i.number}</p>
          <Link to={`/clientes/${i.clientId}`} className="block truncate text-sm hover:underline">
            {i.clientName}
          </Link>
          <InvoiceLines invoice={i} />
        </div>
      ),
    },
    { key: 'issued', header: 'Emisión', cell: (i) => <span className="num">{dayMonth(i.issuedOn)}</span> },
    {
      key: 'due',
      header: 'Vence',
      cell: (i) => (
        <span className={`num ${i.status === 'overdue' ? 'font-semibold text-red' : ''}`}>
          {dayMonth(i.dueOn)}
          {i.status === 'overdue' ? <span className="block text-xs">{overdueLabel(i.daysOverdue)}</span> : null}
        </span>
      ),
    },
    { key: 'amount', header: 'Importe', align: 'right', cell: (i) => <span className="num">{money(i.amountCents)}</span> },
    { key: 'balance', header: 'Saldo', align: 'right', cell: (i) => <span className="num font-bold">{i.voided ? '—' : money(i.balanceCents)}</span> },
    { key: 'status', header: 'Estado', cell: (i) => <Tag status={i.status} /> },
    { key: 'arca', header: 'ARCA', cell: (i) => <ArcaState invoice={i} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      wide: true,
      cell: (i) => (
        <span className="flex flex-wrap gap-1 md:justify-end">
          <EmitButton invoice={i} />
          {!i.voided && i.balanceCents > 0 ? (
            <Button size="sm" variant="accent" onClick={() => open({ type: 'payment', clientId: i.clientId, invoiceId: i.id })}>
              Cobrar
            </Button>
          ) : null}
          {!i.voided ? (
            <Button size="sm" variant="ghost" onClick={() => setVoiding(i)}>
              Anular
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4">
        <Chips label="Estado" value={status} options={FILTERS} onChange={setStatus} />
      </div>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data && data.length > 0 ? (
        <Table
          caption="Facturas"
          columns={columns}
          rows={data}
          rowKey={(i) => i.id}
          mobileCols="grid-cols-3"
          gridClass="md:grid-cols-[minmax(0,1.3fr)_52px_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_84px_minmax(0,1.8fr)_minmax(0,2.2fr)]"
        />
      ) : (
        <EmptyState title="No hay facturas con este estado." />
      )}
      {voiding ? (
        <Confirm
          title="Anular factura"
          confirmLabel="Anular factura"
          onClose={() => setVoiding(null)}
          onConfirm={async () => {
            await voidMutation.mutateAsync(voiding.id);
            toast.success(`Factura ${voiding.number} anulada`);
          }}
        >
          <p>
            Se anulará la factura <strong className="num">{voiding.number}</strong> de {voiding.clientName} por{' '}
            <strong className="num">{money(voiding.amountCents)}</strong>.
          </p>
          {voiding.paidCents > 0 ? (
            <p className="text-muted">Los pagos aplicados ({money(voiding.paidCents)}) quedarán como saldo a favor del cliente.</p>
          ) : null}
        </Confirm>
      ) : null}
    </>
  );
}
