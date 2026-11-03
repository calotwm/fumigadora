import { IPC_MIN_OVERDUE_MONTHS, type DebtMonthWithIpc } from '@fumigadora/shared';
import { useClientMonths, useSetClientIpc } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money, monthLabel } from '../../lib/format';
import { ErrorNote, Table, type Column } from '../../ui/display';
import { Checkbox } from '../../ui/form';
import { useToast } from '../../ui/Toast';

/**
 * Open debt grouped by month (period of the invoice, or the month it was issued), oldest first, with what each overdue
 * month grows when updated by the last published IPC (a reference figure: it is not charged to the account).
 */
export function DebtMonths({ clientId }: { clientId: number }) {
  const query = useClientMonths(clientId);
  const setIpc = useSetClientIpc();
  const toast = useToast();
  if (query.error) return <ErrorNote message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const data = query.data;
  if (!data || data.months.length === 0) return null;
  const creditApplied = data.months.some((m) => m.creditAppliedCents > 0);

  const columns: Column<DebtMonthWithIpc>[] = [
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
        <span className="flex flex-col items-end">
          <span className={`num whitespace-nowrap font-bold ${m.owedCents > 0 ? 'text-red' : ''}`}>{money(m.owedCents)}</span>
          {m.ipcCents > 0 ? <span className="num whitespace-nowrap text-xs text-muted">+ {money(m.ipcCents)} IPC</span> : null}
        </span>
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
      {data.ipc.totalCents > 0 && data.ipc.throughMonth ? (
        <div className="mt-3 flex items-baseline justify-between gap-4 border-l-4 border-yellow bg-paper-2 px-3 py-2 text-sm">
          <p>
            <span className="font-bold">Actualizado por IPC</span>
            <span className="block text-xs text-muted">
              Hasta {monthLabel(data.ipc.throughMonth).toLowerCase()} (INDEC): + {money(data.ipc.totalCents)} sobre la deuda vencida.
            </span>
          </p>
          <span className="num font-extrabold whitespace-nowrap text-red">{money(data.ipc.updatedOwedCents)}</span>
        </div>
      ) : null}
      <div className="mt-3">
        <Checkbox
          label="Actualizar por IPC"
          hint={`Muestra la deuda con más de ${IPC_MIN_OVERDUE_MONTHS} meses vencida actualizada por IPC, acá y en el portal del cliente. No cambia el saldo.`}
          checked={data.ipc.enabled}
          disabled={setIpc.isPending}
          onChange={(ipcEnabled) =>
            setIpc.mutate({ id: clientId, ipcEnabled }, { onError: (e) => toast.error(errorMessage(e)) })
          }
        />
      </div>
      {creditApplied ? <p className="mt-2 text-xs text-muted">El saldo a favor se descuenta de los meses más antiguos.</p> : null}
    </section>
  );
}
