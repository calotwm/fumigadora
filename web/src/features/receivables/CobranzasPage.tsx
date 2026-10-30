import { useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { useReceivables } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { daysAgoLabel, fullDate, money, overdueLabel } from '../../lib/format';
import { debtReminderText, whatsappLink } from '../../lib/whatsapp';
import { AnchorButton, Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead, Stat, Table, Tabs, type Column } from '../../ui/display';
import { Select } from '../../ui/form';
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

const BUCKET_STYLES = ['bg-paper', 'bg-yellow/20', 'bg-yellow/50', 'bg-yellow', 'bg-red text-paper'];

export function CobranzasPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'deudores';
  const sortParam = params.get('orden');
  const sort: SortId = SORT_IDS.find((id) => id === sortParam) ?? DEFAULT_SORT;
  const setSort = (next: SortId) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === DEFAULT_SORT) copy.delete('orden');
        else copy.set('orden', next);
        return copy;
      },
      { replace: true },
    );
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
          <div className="mb-8 grid grid-cols-1 gap-6 border-t-4 border-yellow pt-4 sm:grid-cols-3">
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
          {tab === 'deudores' ? data ? <DebtorsList debtors={data.debtors} sort={sort} onSortChange={setSort} /> : null : tab === 'facturas' ? <InvoicesTab /> : <PaymentsTab />}
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
      <ol className="grid grid-cols-2 border-l border-t border-rule xl:grid-cols-5">
        {data.buckets.map((bucket, index) => (
          <li
            key={bucket.bucket}
            className={`${BUCKET_STYLES[index] ?? ''} border-b border-r border-rule p-3 ${index === 4 ? 'col-span-2 xl:col-span-1' : ''}`}
          >
            <p className={`label-caps ${index === 4 ? '!text-paper' : ''}`}>{BUCKET_LABELS[bucket.bucket]}</p>
            <p className="num mt-2 whitespace-nowrap text-lg font-extrabold leading-none xl:text-2xl">{money(bucket.totalCents)}</p>
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

function DebtorsList({ debtors, sort, onSortChange }: { debtors: Debtor[]; sort: SortId; onSortChange: (next: SortId) => void }) {
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
            {d.overdueSince ? `Vencido el ${fullDate(d.overdueSince)}` : overdueLabel(d.daysOverdue)}
            <span className="block text-xs font-normal text-muted">
              {d.overdueSince ? `${daysAgoLabel(d.daysOverdue)} · ` : ''}
              {BUCKET_LABELS[d.agingBucket]}
            </span>
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
  const sorted = [...debtors].sort(SORTS[sort].compare);
  return (
    <>
      <div className="mb-4 max-w-xs">
        <Select label="Ordenar por" value={sort} onChange={(e) => onSortChange(e.target.value as SortId)}>
          {SORT_IDS.map((id) => (
            <option key={id} value={id}>
              {SORTS[id].label}
            </option>
          ))}
        </Select>
      </div>
      <Table
        caption="Deudores"
        columns={columns}
        rows={sorted}
        rowKey={(d) => d.clientId}
        gridClass="md:grid-cols-[minmax(0,2fr)_1fr_1.4fr_200px]"
      />
    </>
  );
}

const byName = (a: Debtor, b: Debtor) => a.name.localeCompare(b.name, 'es');

const SORTS = {
  'mayor-deuda': { label: 'Mayor deuda primero', compare: (a: Debtor, b: Debtor) => b.balanceCents - a.balanceCents || byName(a, b) },
  'menor-deuda': { label: 'Menor deuda primero', compare: (a: Debtor, b: Debtor) => a.balanceCents - b.balanceCents || byName(a, b) },
  'mas-vencido': { label: 'Vencido hace más tiempo', compare: (a: Debtor, b: Debtor) => b.daysOverdue - a.daysOverdue || byName(a, b) },
  'menos-vencido': { label: 'Vencido hace menos tiempo', compare: (a: Debtor, b: Debtor) => a.daysOverdue - b.daysOverdue || byName(a, b) },
  nombre: { label: 'Nombre (A-Z)', compare: byName },
} as const;
type SortId = keyof typeof SORTS;
const SORT_IDS = Object.keys(SORTS) as SortId[];
const DEFAULT_SORT: SortId = 'mas-vencido';
