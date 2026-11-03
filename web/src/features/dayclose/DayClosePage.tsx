import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, isIsoDate, today } from '@fumigadora/shared';
import { useDaySummary } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { METHOD_LABELS, fullDate, longDate, money } from '../../lib/format';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, PageHeader, SectionHead, Stat } from '../../ui/display';
import { DateInput } from '../../ui/form';
import type { DaySummary } from '../../lib/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Cierre del día": visits, money, invoices, new overdue debt and expenses of one date (`?fecha=`, default today). */
export function DayClosePage() {
  const current = today();
  const [params, setParams] = useSearchParams();
  const raw = params.get('fecha');
  const date = raw && isIsoDate(raw) ? raw : current;
  const summary = useDaySummary(date);

  function go(next: string) {
    if (!isIsoDate(next)) return;
    setParams(
      (cur) => {
        const copy = new URLSearchParams(cur);
        if (next === current) copy.delete('fecha');
        else copy.set('fecha', next);
        return copy;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PageHeader eyebrow="Cierre del día" title={longDate(date)} />
      <div className="mb-6 flex flex-wrap items-end gap-1">
        <button
          type="button"
          aria-label="Día anterior"
          onClick={() => go(addDays(date, -1))}
          className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <Button variant="outline" onClick={() => go(current)} disabled={date === current}>
          Hoy
        </Button>
        <button
          type="button"
          aria-label="Día siguiente"
          onClick={() => go(addDays(date, 1))}
          className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
        <DateInput label="Fecha" value={date} onChange={(e) => go(e.target.value)} wrapperClassName="ml-2 w-44" />
      </div>
      {summary.isLoading ? (
        <Loading />
      ) : summary.error || !summary.data ? (
        <ErrorNote message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
      ) : (
        <DayCloseView data={summary.data} />
      )}
    </>
  );
}

function DayCloseView({ data }: { data: DaySummary }) {
  const { visits, collections, invoices, newOverdue, expenses } = data;
  const handover = collections.cashToHandOver;
  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Resumen" className="section-head">
        <div className="grid gap-x-8 gap-y-6 pt-3 md:grid-cols-4">
          <Stat
            label="Visitas"
            size="md"
            value={`${visits.totals.done} / ${visits.totals.done + visits.totals.pending}`}
            note={`${plural(visits.totals.done, 'hecha', 'hechas')} · ${plural(visits.totals.pending, 'pendiente', 'pendientes')}`}
          />
          <Stat label="Cobrado" size="md" value={money(collections.totalCents)} note={plural(collections.count, 'cobro', 'cobros')} />
          <Stat label="Facturado" size="md" value={money(invoices.totalCents)} note={plural(invoices.count, 'factura', 'facturas')} />
          <Stat label="Gastos" size="md" value={money(expenses.totalCents)} note={plural(expenses.count, 'gasto', 'gastos')} />
        </div>
      </section>

      <section aria-label="Visitas por empleado">
        <SectionHead title="Visitas por empleado" />
        {visits.byEmployee.length === 0 ? (
          <EmptyState title="No hubo visitas este día." />
        ) : (
          <ul className="border-t border-ink">
            {visits.byEmployee.map((e) => (
              <li key={e.userId ?? 'none'} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule py-3 text-sm">
                <span className="font-bold">{e.name}</span>
                <span className="num text-muted">
                  <span className="font-semibold text-ink">{plural(e.done, 'hecha', 'hechas')}</span> ·{' '}
                  {plural(e.pending, 'pendiente', 'pendientes')} · {plural(e.postponed, 'pospuesta', 'pospuestas')} ·{' '}
                  {plural(e.cancelled, 'cancelada', 'canceladas')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {visits.totals.postponed > 0 ? (
          <p className="mt-2 text-xs text-muted">Las pospuestas son las que el empleado movió de día desde la app.</p>
        ) : null}
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-label="Cobrado por medio de pago">
          <SectionHead title="Cobrado por medio de pago" />
          {collections.byMethod.length === 0 ? (
            <EmptyState title="No se cobró nada este día." />
          ) : (
            <ul className="border-t border-ink">
              {collections.byMethod.map((m) => (
                <li key={m.method} className="flex items-baseline justify-between gap-3 border-b border-rule py-3 text-sm">
                  <span className="font-semibold">
                    {METHOD_LABELS[m.method]} <span className="text-muted">({m.count})</span>
                  </span>
                  <span className="num font-extrabold">{money(m.cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Cobrado por empleado">
          <SectionHead title="Cobrado por empleado" />
          {collections.byEmployee.length === 0 ? (
            <EmptyState title="No se cobró nada este día." />
          ) : (
            <ul className="border-t border-ink">
              {collections.byEmployee.map((e) => (
                <li key={e.userId ?? 'office'} className="border-b border-rule py-3 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{e.name}</span>
                    <span className="num font-extrabold">{money(e.cents)}</span>
                  </div>
                  {e.cashCents > 0 || e.toHandOverCents > 0 ? (
                    <p className="num text-xs text-muted">
                      Efectivo {money(e.cashCents)}
                      {e.toHandOverCents > 0 ? <span className="font-semibold text-red"> · a rendir {money(e.toHandOverCents)}</span> : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm">
            Efectivo a rendir de este día: <span className="num font-bold">{money(handover.dayCents)}</span>. Total pendiente de rendir:{' '}
            <span className="num font-bold">{money(handover.totalCents)}</span> ({plural(handover.totalCount, 'cobro', 'cobros')}).{' '}
            <Link to="/finanzas?tab=efectivo" className="font-semibold underline underline-offset-2">
              Ver efectivo a rendir
            </Link>
          </p>
        </section>
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <section aria-label="Facturas emitidas">
          <SectionHead title="Facturas emitidas" />
          {invoices.items.length === 0 ? (
            <EmptyState title="No se emitieron facturas este día." />
          ) : (
            <ul className="border-t border-ink">
              {invoices.items.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 border-b border-rule py-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="num font-semibold">{i.number}</span> ·{' '}
                    <Link to={`/clientes/${i.clientId}`} className="hover:underline">
                      {i.clientName}
                    </Link>
                  </span>
                  <span className="num font-extrabold">{money(i.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Deuda que venció este día">
          <SectionHead title="Deuda que venció este día" />
          {newOverdue.items.length === 0 ? (
            <EmptyState title="No venció deuda nueva este día." />
          ) : (
            <ul className="border-t border-ink">
              {newOverdue.items.map((i) => (
                <li key={i.invoiceId} className="flex items-baseline justify-between gap-3 border-b border-rule py-3 text-sm">
                  <span className="min-w-0 truncate">
                    <Link to={`/clientes/${i.clientId}`} className="font-semibold hover:underline">
                      {i.clientName}
                    </Link>{' '}
                    <span className="text-muted">
                      · {i.number} · venció {fullDate(i.dueOn)}
                    </span>
                  </span>
                  <span className="num font-extrabold text-red">{money(i.balanceCents)}</span>
                </li>
              ))}
              <li className="flex justify-between py-3 text-sm font-bold">
                <span>Total</span>
                <span className="num">{money(newOverdue.totalCents)}</span>
              </li>
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Gastos del día">
        <SectionHead title="Gastos del día" />
        {expenses.items.length === 0 ? (
          <EmptyState title="No se registraron gastos este día." />
        ) : (
          <ul className="border-t border-ink">
            {expenses.items.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 border-b border-rule py-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{e.categoryName ?? 'Sin categoría'}</span>
                  <span className="text-muted">
                    {' '}
                    · {METHOD_LABELS[e.method]}
                    {e.description ? ` · ${e.description}` : ''}
                  </span>
                </span>
                <span className="num font-extrabold">− {money(e.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
