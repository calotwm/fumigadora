import type { DebtMonth } from '@fumigadora/shared';
import { useClientMonths } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money, monthLabel } from '../../lib/format';
import { ErrorNote, Table, type Column } from '../../ui/display';

/** Open debt grouped by month (period of the invoice, or the month it was issued), oldest first. */
export function DebtMonths({ clientId }: { clientId: number }) {
  const query = useClientMonths(clientId);
  if (query.error) return <ErrorNote message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data || data.months.length === 0) return null;
  const creditApplied = data.months.some((m) => m.creditAppliedCents > 0);

  const columns: Column<DebtMonth>[] = [
    {
      key: 'month',
      header: 'Mes',
      primary: true,
      cell: (m) => (
        <div className="min-w-0">
          <p className="font-semibold">{monthLabel(m.month)}</p>
          <p className="truncate text-xs text-muted">
            {m.invoices.length === 1 ? `Factura ${m.invoices[0]!.number}` : `${m.invoices.length} facturas`}
          </p>
        </div>
      ),
    },
    { key: 'billed', header: 'Facturado', align: 'right', cell: (m) => <span className="num whitespace-nowrap">{money(m.billedCents)}</span> },
    {
      key: 'paid',
      header: 'Pagado',
      align: 'right',
      cell: (m) => (
        <span className="num whitespace-nowrap">{m.paidCents + m.creditAppliedCents ? money(m.paidCents + m.creditAppliedCents) : '—'}</span>
      ),
    },
    {
      key: 'owed',
      header: 'Adeuda',
      align: 'right',
      cell: (m) => (
        <span className={`num whitespace-nowrap font-bold ${m.owedCents > 0 ? 'text-red' : ''}`}>{money(m.owedCents)}</span>
      ),
    },
  ];

  return (
    <section className="mb-10">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h3 className="label-caps !text-ink">Deuda por mes</h3>
        <p className="text-sm">
          <span className="label-caps mr-2">Total</span>
          <span className={`num font-extrabold whitespace-nowrap ${data.totalOwedCents > 0 ? 'text-red' : ''}`}>
            {money(data.totalOwedCents)}
          </span>
        </p>
      </div>
      <Table
        caption="Deuda por mes"
        columns={columns}
        rows={data.months}
        rowKey={(m) => m.month}
        mobileCols="grid-cols-3"
        gridClass="md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr]"
      />
      {creditApplied ? <p className="mt-2 text-xs text-muted">El saldo a favor se descuenta de los meses más antiguos.</p> : null}
    </section>
  );
}
