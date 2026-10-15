import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, SectionHead, Stat } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useCashHandover, useConfirmHandover } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate, money } from '../../lib/format';
import type { CashHandover } from '../../lib/types';

/** Cash collected by employees in the field, waiting for the owner to confirm receipt. */
export function CashHandoverPanel() {
  const { data, error, isLoading, refetch } = useCashHandover();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />;
  return <HandoverView data={data} />;
}

function HandoverView({ data }: { data: CashHandover }) {
  const toast = useToast();
  const confirm = useConfirmHandover();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function toggle(ids: number[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function receive(ids: number[], label: string) {
    confirm.mutate(ids, {
      onSuccess: () => {
        toast.success(`Recibiste el efectivo de ${label}`);
        setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Resumen de efectivo a rendir" className="section-head !border-yellow">
        <div className="grid gap-6 pt-3 sm:grid-cols-2">
          <Stat
            label="Efectivo a rendir"
            value={money(data.pendingCents)}
            note={data.pendingCount > 0 ? `${data.pendingCount} ${data.pendingCount === 1 ? 'cobro' : 'cobros'} sin confirmar` : 'Todo rendido'}
          />
        </div>
      </section>

      <section aria-label="Pendiente por empleado">
        <SectionHead title="Pendiente por empleado" />
        {data.employees.length === 0 ? (
          <EmptyState title="Ningún empleado tiene efectivo pendiente de entrega." />
        ) : (
          <div className="flex flex-col gap-8">
            {data.employees.map((employee) => {
              const ids = employee.items.map((i) => i.paymentId);
              const chosen = employee.items.filter((i) => selected.has(i.paymentId));
              const chosenCents = chosen.reduce((sum, i) => sum + i.amountCents, 0);
              const allChosen = chosen.length === employee.items.length;
              return (
                <article key={employee.userId} aria-label={employee.name} className="border border-ink">
                  <header className="flex flex-wrap items-center justify-between gap-3 bg-ink px-4 py-3 text-paper on-ink">
                    <div>
                      <h3 className="text-base font-extrabold">{employee.name}</h3>
                      <p className="text-xs text-paper/70">
                        {employee.count} {employee.count === 1 ? 'cobro' : 'cobros'}
                      </p>
                    </div>
                    <p className="num text-2xl font-extrabold text-yellow">{money(employee.pendingCents)}</p>
                  </header>
                  <div className="px-4">
                    <Checkbox
                      label="Seleccionar todos"
                      checked={allChosen}
                      onChange={(on) => toggle(ids, on)}
                    />
                    <ul className="border-t border-rule">
                      {employee.items.map((item) => (
                        <li key={item.paymentId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-b border-rule last:border-b-0">
                          <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                            <input
                              type="checkbox"
                              className="size-5 accent-ink"
                              checked={selected.has(item.paymentId)}
                              onChange={(e) => toggle([item.paymentId], e.target.checked)}
                              aria-label={`${item.clientName} ${money(item.amountCents)}`}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold">{item.clientName}</span>
                              <span className="block text-xs text-muted num">{fullDate(item.date)}</span>
                            </span>
                          </label>
                          <span className="num font-extrabold">{money(item.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink bg-paper-2 px-4 py-3">
                    <p className="text-sm">
                      {chosen.length > 0 ? (
                        <>
                          Seleccionado: <span className="num font-extrabold">{money(chosenCents)}</span>
                        </>
                      ) : (
                        <span className="text-muted">Marcá los cobros que recibiste</span>
                      )}
                    </p>
                    <Button
                      variant="accent"
                      disabled={chosen.length === 0 || confirm.isPending}
                      onClick={() => receive(chosen.map((i) => i.paymentId), employee.name)}
                    >
                      Confirmar recibido
                    </Button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-label="Entregas recientes">
        <SectionHead title="Recibido recientemente" />
        {data.recent.length === 0 ? (
          <EmptyState title="Todavía no confirmaste ninguna entrega." />
        ) : (
          <ul className="border-t border-ink">
            {data.recent.map((item) => (
              <li key={item.paymentId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-b border-rule py-3">
                <div className="min-w-0">
                  <Link to={`/clientes/${item.clientId}`} className="block truncate text-sm font-bold hover:underline">
                    {item.clientName}
                  </Link>
                  <p className="truncate text-xs text-muted">
                    {item.userName} · cobrado el {fullDate(item.date)} · recibido el {fullDate(item.handedOverAt.slice(0, 10))}
                  </p>
                </div>
                <span className="num font-extrabold">{money(item.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
