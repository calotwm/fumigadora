import { Link } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { useDashboard } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import {
  daysLeftLabel,
  deltaLabel,
  longDate,
  money,
  overdueLabel,
  percentDelta,
} from '../../lib/format';
import { debtReminderText, whatsappLink } from '../../lib/whatsapp';
import { monthLabelEs } from '@fumigadora/shared';
import { AnchorButton, Button, LinkButton } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, ProgressBar, SectionHead, Stat } from '../../ui/display';
import { useActions } from '../actions/ActionsProvider';
import type { Dashboard } from '../../lib/types';

export function DashboardPage() {
  const { data, error, isLoading, refetch } = useDashboard();
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />;
  return <DashboardView data={data} />;
}

function DashboardView({ data }: { data: Dashboard }) {
  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="label-caps">Hoy</p>
        <h1 className="text-2xl font-extrabold tracking-tight md:text-4xl">{longDate(data.today)}</h1>
      </header>
      <KpiStrip data={data} />
      <div className="grid gap-10 lg:grid-cols-12">
        <section aria-labelledby="agenda-h" className="lg:col-span-8">
          <AgendaBlock data={data} />
        </section>
        <section aria-labelledby="debtors-h" className="lg:col-span-4">
          <DebtorsBlock data={data} />
        </section>
      </div>
      <TrackingBlock data={data} />
      <AlertsRow data={data} />
      <ServicesBlock data={data} />
    </div>
  );
}

function KpiStrip({ data }: { data: Dashboard }) {
  const { month, receivables } = data;
  const prev = month.previous;
  return (
    <section aria-label="Resumen del mes" className="section-head !border-yellow">
      <p className="label-caps mb-4 !text-ink">{monthLabelEs(month.month)}</p>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Stat
            label="Te deben"
            tone={receivables.owedCents > 0 ? 'red' : 'default'}
            value={money(receivables.owedCents)}
            note={
              receivables.overdueCents > 0 ? (
                <span className="font-semibold text-red">{money(receivables.overdueCents)} vencido</span>
              ) : (
                'Sin vencidos'
              )
            }
            delta={`${receivables.debtorCount} ${receivables.debtorCount === 1 ? 'cliente' : 'clientes'}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:col-span-7">
          <Stat size="md" label="Ingresó este mes" value={money(month.incomeCents)} delta={deltaLabel(month.incomeCents, prev.incomeCents)} />
          <Stat size="md" label="Gastos" value={money(month.expensesCents)} delta={deltaLabel(month.expensesCents, prev.expensesCents)} />
          <div className="col-span-2 sm:col-span-1">
            <Stat size="md" label="Balance" value={money(month.balanceCents)} delta={deltaLabel(month.balanceCents, prev.balanceCents)} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="flex-1 sm:border-l sm:border-rule sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <p className="label-caps">{label}</p>
      <p className={`num text-4xl font-extrabold leading-none tracking-tight ${tone === 'red' ? 'text-red' : ''}`}>{value}</p>
    </div>
  );
}

function AgendaBlock({ data }: { data: Dashboard }) {
  const { open } = useActions();
  const { agenda, todayVisits } = data;
  return (
    <>
      <div id="agenda-h">
        <SectionHead
          title="Agenda"
          action={
            <Link to="/agenda" className="text-xs font-semibold uppercase tracking-wider underline">
              Ver agenda
            </Link>
          }
        />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:flex">
        <Counter label="Hoy" value={agenda.today} />
        <Counter label="Mañana" value={agenda.tomorrow} />
        <Counter label="Esta semana" value={agenda.thisWeek} />
        {agenda.overdueScheduled > 0 ? <Counter label="Atrasadas" value={agenda.overdueScheduled} tone="red" /> : null}
      </div>
      {todayVisits.length === 0 ? (
        <EmptyState
          title="No hay visitas para hoy."
          action={
            <Button size="sm" variant="outline" onClick={() => open({ type: 'visit' })}>
              Nueva visita
            </Button>
          }
        />
      ) : (
        <ul className="border-t border-ink">
          {todayVisits.map((visit) => (
            <li
              key={visit.id}
              className="grid grid-cols-[56px_1fr_auto] items-center gap-x-3 gap-y-1 border-b border-rule py-3"
            >
              <span className="num text-xl font-extrabold">{visit.time ?? '—'}</span>
              <div className="min-w-0">
                <Link to={`/clientes/${visit.clientId}`} className="block truncate text-base font-bold hover:underline">
                  {visit.clientName}
                </Link>
                <p className="truncate text-sm text-muted">
                  {visit.serviceTypeName}
                  {visit.clientAddress ? ` · ${visit.clientAddress}` : ''}
                </p>
              </div>
              {visit.status === 'scheduled' ? (
                <Button size="sm" onClick={() => open({ type: 'completeVisit', visit })}>
                  Completar
                </Button>
              ) : (
                <span className="label-caps !text-ink">{visit.status === 'done' ? 'Realizada' : 'Cancelada'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DebtorsBlock({ data }: { data: Dashboard }) {
  const { open } = useActions();
  return (
    <>
      <div id="debtors-h">
        <SectionHead
          title="Cobrar primero"
          action={
            <Link to="/cobranzas" className="text-xs font-semibold uppercase tracking-wider underline">
              Cobranzas
            </Link>
          }
        />
      </div>
      {data.topDebtors.length === 0 ? (
        <EmptyState title="No hay deudas pendientes." />
      ) : (
        <ul className="border-t border-ink">
          {data.topDebtors.map((debtor) => {
            const wa = whatsappLink(debtor.phone, debtReminderText(debtor.name, debtor.balanceCents));
            return (
              <li key={debtor.clientId} className="border-b border-rule py-3">
                <Link to={`/clientes/${debtor.clientId}`} className="block truncate text-base font-bold hover:underline">
                  {debtor.name}
                </Link>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num whitespace-nowrap text-xl font-extrabold">{money(debtor.balanceCents)}</span>
                  <span className={`text-xs ${debtor.daysOverdue > 0 ? 'font-semibold text-red' : 'text-muted'}`}>
                    {debtor.daysOverdue > 0 ? overdueLabel(debtor.daysOverdue) : 'Al día'}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="accent" onClick={() => open({ type: 'payment', clientId: debtor.clientId })}>
                    Cobrar
                  </Button>
                  {wa ? (
                    <AnchorButton
                      size="sm"
                      variant="outline"
                      href={wa}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Enviar recordatorio por WhatsApp a ${debtor.name}`}
                      icon={<MessageCircle size={14} aria-hidden />}
                    >
                      WhatsApp
                    </AnchorButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function TrackingBlock({ data }: { data: Dashboard }) {
  const { expected, done, scheduled, pendingUnscheduled, clientsTracked } = data.tracking;
  if (clientsTracked === 0) return null;
  return (
    <section aria-label="Servicios del mes">
      <SectionHead
        title="Servicios del mes"
        action={
          <Link to="/agenda?view=seguimiento" className="text-xs font-semibold uppercase tracking-wider underline">
            Ver seguimiento
          </Link>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
        <p className="num text-4xl font-extrabold leading-none tracking-tight">
          {done} <span className="text-2xl font-bold text-muted">de {expected}</span>
        </p>
        <p className="num text-sm">
          <strong>{pendingUnscheduled}</strong> {pendingUnscheduled === 1 ? 'pendiente' : 'pendientes'} sin agendar
          <span className="text-muted"> · {scheduled} agendados</span>
        </p>
      </div>
      <div className="mt-3 max-w-3xl">
        <ProgressBar value={done} max={expected} label="Servicios realizados del mes" />
      </div>
      {pendingUnscheduled > 0 ? (
        <div className="mt-3">
          <LinkButton to="/agenda?view=seguimiento&estado=pending" variant="outline" size="sm">
            Agendar pendientes
          </LinkButton>
        </div>
      ) : null}
    </section>
  );
}

function AlertsRow({ data }: { data: Dashboard }) {
  const { receivables, expiringCertificates, clientsWithoutNextVisit } = data;
  return (
    <section aria-label="Alertas">
      <SectionHead title="Alertas" />
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <p className="label-caps">Facturas vencidas</p>
          <p className={`num text-2xl font-extrabold ${receivables.overdueInvoiceCount > 0 ? 'text-red' : ''}`}>
            {receivables.overdueInvoiceCount}
          </p>
          <p className="text-sm text-muted">
            {receivables.overdueInvoiceCount > 0 ? `${money(receivables.overdueCents)} vencido` : 'Todo al día'}
          </p>
          {receivables.overdueInvoiceCount > 0 ? (
            <Link to="/cobranzas" className="text-xs font-semibold uppercase tracking-wider underline">
              Ver cobranzas
            </Link>
          ) : null}
        </div>
        <div>
          <p className="label-caps">Obleas por vencer</p>
          <p className="num text-2xl font-extrabold">
            {expiringCertificates.length}
          </p>
          {expiringCertificates.length === 0 ? (
            <p className="text-sm text-muted">Ninguna en los próximos 15 días</p>
          ) : (
            <ul className="mt-1 text-sm">
              {expiringCertificates.slice(0, 3).map((cert) => (
                <li key={cert.id}>
                  <Link to={`/clientes/${cert.clientId}?tab=obleas`} className="font-semibold hover:underline">
                    {cert.clientName}
                  </Link>{' '}
                  <span className="text-muted">· {daysLeftLabel(cert.daysLeft)}</span>
                </li>
              ))}
              {expiringCertificates.length > 3 ? (
                <li className="text-muted">y {expiringCertificates.length - 3} más</li>
              ) : null}
            </ul>
          )}
        </div>
        <div>
          <p className="label-caps">Clientes sin visita programada</p>
          <p className="num text-2xl font-extrabold">{clientsWithoutNextVisit}</p>
          <p className="text-sm text-muted">
            {clientsWithoutNextVisit > 0 ? 'Tuvieron servicio reciente y no tienen próxima visita' : 'Todos con próxima visita'}
          </p>
          {clientsWithoutNextVisit > 0 ? (
            <LinkButton to="/clientes" variant="ghost" size="sm" className="-ml-3">
              Ver clientes
            </LinkButton>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ServicesBlock({ data }: { data: Dashboard }) {
  const { doneThisMonth, doneLastMonth } = data.services;
  const pct = percentDelta(doneThisMonth, doneLastMonth);
  return (
    <section aria-label="Servicios realizados">
      <SectionHead title="Servicios realizados este mes" />
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <Stat size="md" label="Este mes" value={doneThisMonth} />
        <Stat size="md" label="Mes anterior" value={doneLastMonth} />
        <p className="num pb-1 text-sm text-muted">
          {pct === null ? 'Sin datos del mes anterior' : pct === 0 ? 'Igual que el mes anterior' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)} %`}
        </p>
      </div>
    </section>
  );
}

