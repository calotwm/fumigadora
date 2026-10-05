import { useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { useReceivables } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money, overdueLabel } from '../../lib/format';
import { debtReminderText, whatsappLink } from '../../lib/whatsapp';
import { AnchorButton, Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead, Stat, Table, Tabs, type Column } from '../../ui/display';
import { useActions } from '../actions/ActionsProvider';
import { BUCKET_LABELS } from '../clients/balance';
import type { Debtor, Receivables } from '../../lib/types';
import { BatchSheet } from './BatchSheet';
import { InvoicesTab } from './InvoicesTab';
import { PaymentsTab } from './PaymentsTab';
import { useState } from 'react';

const TABS = [
  { id: 'deudores', label: 'Deudores' },
  { id: 'facturas', label: 'Facturas' },
  { id: 'pagos', label: 'Pagos' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const BUCKET_STYLES = ['bg-paper', 'bg-red/10', 'bg-red/25', 'bg-red/55', 'bg-red text-paper'];

export function CobranzasPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'deudores';
  const [batchOpen, setBatchOpen] = useState(false);
  const { data, error, isLoading, refetch } = useReceivables();

  return (
    <>
      <PageHeader
        eyebrow="Cobranzas"
        title="Cuentas a cobrar"
        actions={<Button onClick={() => setBatchOpen(true)}>Facturar abonos del mes</Button>}
      />
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-1 gap-6 border-t-4 border-ink pt-4 sm:grid-cols-3">
            <Stat size="md" label="Te deben" tone={data.owedCents > 0 ? 'red' : 'default'} value={money(data.owedCents)} delta={`${data.debtorCount} clientes`} />
            <Stat size="md" label="Vencido" tone={data.overdueCents > 0 ? 'red' : 'default'} value={money(data.overdueCents)} />
            <Stat size="md" label="Facturas vencidas" value={data.overdueInvoiceCount} delta={money(data.overdueInvoicesCents)} />
          </div>
          <AgingBoard data={data} />
        </>
      )}
      <div className="mt-10">
        <Tabs
          label="Secciones de cobranzas"
          tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={tab}
          onChange={(next) =>
            setParams(
              (current) => {
                const copy = new URLSearchParams(current);
                if (next === 'deudores') copy.delete('tab');
                else copy.set('tab', next);
                return copy;
              },
              { replace: true },
            )
          }
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
          {tab === 'deudores' ? data ? <DebtorsList debtors={data.debtors} /> : null : tab === 'facturas' ? <InvoicesTab /> : <PaymentsTab />}
        </div>
      </div>
      {batchOpen ? <BatchSheet onClose={() => setBatchOpen(false)} /> : null}
    </>
  );
}

function AgingBoard({ data }: { data: Receivables }) {
  return (
    <section aria-label="Antigüedad de la deuda">
      <SectionHead title="Antigüedad de la deuda" />
      <ol className="grid grid-cols-2 border-l border-t border-rule md:grid-cols-5">
        {data.buckets.map((bucket, index) => (
          <li
            key={bucket.bucket}
            className={`${BUCKET_STYLES[index] ?? ''} border-b border-r border-rule p-3 ${index === 4 ? 'col-span-2 md:col-span-1' : ''}`}
          >
            <p className={`label-caps ${index === 4 ? '!text-paper' : ''}`}>{BUCKET_LABELS[bucket.bucket]}</p>
            <p className="num mt-2 text-xl font-extrabold leading-none md:text-2xl">{money(bucket.totalCents)}</p>
            <p className={`mt-2 text-xs ${index === 4 ? 'text-paper' : 'text-muted'}`}>
              {bucket.invoiceCount} {bucket.invoiceCount === 1 ? 'factura' : 'facturas'} · {bucket.clientCount}{' '}
              {bucket.clientCount === 1 ? 'cliente' : 'clientes'}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DebtorsList({ debtors }: { debtors: Debtor[] }) {
  const { open } = useActions();
  const columns: Column<Debtor>[] = [
    {
      key: 'name',
      header: 'Cliente',
      primary: true,
      cell: (d) => (
        <Link to={`/clientes/${d.clientId}`} className="text-base font-bold hover:underline">
          {d.name}
        </Link>
      ),
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      cell: (d) => <span className="num font-extrabold">{money(d.balanceCents)}</span>,
    },
    {
      key: 'age',
      header: 'Antigüedad',
      cell: (d) =>
        d.daysOverdue > 0 ? (
          <span className="font-semibold text-red">
            {overdueLabel(d.daysOverdue)}
            <span className="block text-xs font-normal text-muted">{BUCKET_LABELS[d.agingBucket]}</span>
          </span>
        ) : (
          <span className="text-muted">Al día</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      wide: true,
      cell: (d) => {
        const wa = whatsappLink(d.phone, debtReminderText(d.name, d.balanceCents));
        return (
          <span className="flex gap-2 md:justify-end">
            <Button size="sm" variant="accent" onClick={() => open({ type: 'payment', clientId: d.clientId })}>
              Cobrar
            </Button>
            {wa ? (
              <AnchorButton
                size="sm"
                variant="outline"
                href={wa}
                target="_blank"
                rel="noreferrer"
                aria-label={`Enviar recordatorio por WhatsApp a ${d.name}`}
                icon={<MessageCircle size={14} aria-hidden />}
              >
                WhatsApp
              </AnchorButton>
            ) : null}
          </span>
        );
      },
    },
  ];
  if (debtors.length === 0) return <EmptyState title="No hay clientes con deuda." />;
  return (
    <Table
      caption="Deudores"
      columns={columns}
      rows={debtors}
      rowKey={(d) => d.clientId}
      gridClass="md:grid-cols-[minmax(0,2fr)_1fr_1.4fr_200px]"
    />
  );
}
