import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonthsToMonth, isIsoMonth, monthLabelEs, today } from '@fumigadora/shared';
import { useDeleteCashEntry, useFinanceSummary, useMovements } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, deltaLabel, fullDate, money } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead, Stat } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useActions } from '../actions/ActionsProvider';
import type { FinanceSummary, Movement } from '../../lib/types';
import { CashEntrySheet } from './CashEntrySheet';
import { MonthChart } from './MonthChart';

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function FinanzasPage() {
  const current = today().slice(0, 7);
  const [params, setParams] = useSearchParams();
  const raw = params.get('m');
  const month = raw && isIsoMonth(raw) && raw <= current ? raw : current;
  const { open } = useActions();
  const summary = useFinanceSummary(month);

  function go(next: string) {
    setParams(
      (cur) => {
        const copy = new URLSearchParams(cur);
        if (next === current) copy.delete('m');
        else copy.set('m', next);
        return copy;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Finanzas"
        title={cap(monthLabelEs(month))}
        actions={
          <>
            <Button variant="outline" onClick={() => open({ type: 'income' })}>
              Registrar ingreso
            </Button>
            <Button onClick={() => open({ type: 'expense' })}>Registrar gasto</Button>
          </>
        }
      />
      <div className="mb-6 flex items-center gap-1">
        <button
          type="button"
          aria-label="Mes anterior"
          onClick={() => go(addMonthsToMonth(month, -1))}
          className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <Button variant="outline" onClick={() => go(current)} disabled={month === current}>
          Este mes
        </Button>
        <button
          type="button"
          aria-label="Mes siguiente"
          disabled={month >= current}
          onClick={() => go(addMonthsToMonth(month, 1))}
          className="grid size-11 place-items-center border border-ink hover:bg-paper-2 disabled:opacity-30"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {summary.isLoading ? (
        <Loading />
      ) : summary.error || !summary.data ? (
        <ErrorNote message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
      ) : (
        <SummaryView data={summary.data} />
      )}
      <Movements month={month} />
    </>
  );
}

function SummaryView({ data }: { data: FinanceSummary }) {
  const prev = data.previous;
  return (
    <>
      <section aria-label="Resumen" className="section-head mb-10">
        <div className="grid gap-x-8 gap-y-6 pt-3 md:grid-cols-3">
          <Stat
            label="Ingresos"
            value={money(data.incomeCents)}
            note={`Cobros ${money(data.paymentsCents)} · Otros ${money(data.otherIncomeCents)}`}
            delta={deltaLabel(data.incomeCents, prev.incomeCents)}
          />
          <Stat label="Gastos" value={money(data.expensesCents)} delta={deltaLabel(data.expensesCents, prev.expensesCents)} />
          <Stat
            label="Balance"
            tone={data.balanceCents < 0 ? 'red' : 'default'}
            value={money(data.balanceCents)}
            delta={deltaLabel(data.balanceCents, prev.balanceCents)}
          />
        </div>
      </section>

      <div className="mb-10 grid gap-10 lg:grid-cols-12">
        <section aria-label="Comparativo de seis meses" className="lg:col-span-7">
          <SectionHead title="Últimos 6 meses" />
          <MonthChart series={data.series} />
        </section>
        <section aria-label="Gastos por categoría" className="lg:col-span-5">
          <SectionHead title="Gastos por categoría" />
          {data.byCategory.length === 0 ? (
            <EmptyState title="Sin gastos en este mes." />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.byCategory.map((cat) => (
                <li key={cat.categoryId}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold">{cat.name}</span>
                    <span className="num">
                      <span className="font-bold">{money(cat.totalCents)}</span>{' '}
                      <span className="text-muted">{String(cat.share).replace('.', ',')} %</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 bg-paper-2" role="presentation">
                    <div className="h-full bg-ink" style={{ width: `${Math.max(cat.share, 1)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Movements({ month }: { month: string }) {
  const { data, error, isLoading, refetch } = useMovements(month);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [deleting, setDeleting] = useState<Movement | null>(null);
  const remove = useDeleteCashEntry();
  const toast = useToast();

  return (
    <section aria-label="Movimientos">
      <SectionHead title="Movimientos" />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : !data || data.movements.length === 0 ? (
        <EmptyState title="No hay movimientos en este mes." />
      ) : (
        <ul className="border-t border-ink">
          {data.movements.map((m) => {
            const manual = m.type !== 'payment';
            return (
              <li key={`${m.type}-${m.id}`} className="grid grid-cols-[56px_1fr_auto] items-center gap-x-3 gap-y-1 border-b border-rule py-3">
                <span className="num text-sm font-semibold">{fullDate(m.date).slice(0, 5)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {m.type === 'payment' ? (
                      <Link to={`/clientes/${m.clientId}`} className="hover:underline">
                        {m.clientName}
                      </Link>
                    ) : (
                      (m.categoryName ?? 'Ingreso manual')
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {m.type === 'payment' ? 'Cobro' : m.type === 'income' ? 'Ingreso' : 'Gasto'}
                    {m.method ? ` · ${METHOD_LABELS[m.method]}` : ''}
                    {m.description ? ` · ${m.description}` : ''}
                  </p>
                </div>
                <span className="num whitespace-nowrap font-extrabold">
                  {m.direction === 'out' ? '−' : '+'} {money(m.amountCents)}
                </span>
                {manual ? (
                  <div className="col-start-2 col-span-2 flex gap-1">
                    <Button size="sm" variant="ghost" className="-ml-3" onClick={() => setEditing(m)} aria-label="Editar movimiento">
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(m)} aria-label="Eliminar movimiento">
                      Eliminar
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <CashEntrySheet kind={editing.type === 'income' ? 'income' : 'expense'} entry={editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? (
        <Confirm
          title="Eliminar movimiento"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            toast.success('Movimiento eliminado');
          }}
        >
          <p>
            Se eliminará {deleting.type === 'income' ? 'el ingreso' : 'el gasto'} de <strong className="num">{money(deleting.amountCents)}</strong> del{' '}
            {fullDate(deleting.date)}.
          </p>
        </Confirm>
      ) : null}
    </section>
  );
}
