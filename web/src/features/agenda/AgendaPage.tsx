import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  isIsoDate,
  monthLabelEs,
  monthOf,
  startOfMonth,
  startOfWeek,
  today as todayIso,
} from '@fumigadora/shared';
import { useAgendaSummary, useVisits } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { dayMonth, longDate } from '../../lib/format';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, PageHeader, Tabs } from '../../ui/display';
import { useActions } from '../actions/ActionsProvider';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { TrackingView } from './TrackingView';
import { UpcomingView } from './UpcomingView';
import { WeekView } from './WeekView';

const VIEWS = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'proximas', label: 'Próximas' },
  { id: 'seguimiento', label: 'Seguimiento' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

export function AgendaPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const view: ViewId = VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'dia';
  const rawDate = params.get('d');
  const date = rawDate && isIsoDate(rawDate) ? rawDate : today;
  const { open } = useActions();
  const summary = useAgendaSummary();

  function update(next: { view?: ViewId; d?: string }) {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        const nextView = next.view ?? view;
        const nextDate = next.d ?? date;
        if (nextView === 'dia') copy.delete('view');
        else copy.set('view', nextView);
        if (nextDate === today) copy.delete('d');
        else copy.set('d', nextDate);
        if (nextView !== 'seguimiento') {
          copy.delete('zona');
          copy.delete('estado');
        }
        return copy;
      },
      { replace: true },
    );
  }

  const range = useMemo(() => {
    if (view === 'dia') return { from: date, to: date };
    if (view === 'semana') return { from: startOfWeek(date), to: endOfWeek(date) };
    if (view === 'mes') return { from: startOfWeek(startOfMonth(date)), to: endOfWeek(endOfMonth(date)) };
    return { from: undefined, to: undefined };
  }, [view, date]);

  const visitsQuery = useVisits(
    view === 'proximas' ? { status: 'scheduled' } : { from: range.from, to: range.to },
    view !== 'seguimiento',
  );
  const visits = (visitsQuery.data ?? []).filter((v) => v.status !== 'cancelled');

  function step(direction: -1 | 1) {
    if (view === 'dia') update({ d: addDays(date, direction) });
    else if (view === 'semana') update({ d: addDays(date, 7 * direction) });
    else if (view === 'mes' || view === 'seguimiento') update({ d: addMonths(startOfMonth(date), direction) });
  }

  const title =
    view === 'dia'
      ? longDate(date)
      : view === 'semana'
        ? `${dayMonth(startOfWeek(date))} al ${dayMonth(endOfWeek(date))}`
        : view === 'mes' || view === 'seguimiento'
          ? monthLabelEs(monthOf(date)).replace(/^./, (c) => c.toUpperCase())
          : 'Próximas visitas';

  const counters = summary.data;

  return (
    <>
      <PageHeader
        eyebrow="Agenda"
        title="Visitas"
        actions={
          <Button icon={<Plus size={16} aria-hidden />} onClick={() => open({ type: 'visit', date: view === 'dia' || view === 'semana' ? date : undefined })}>
            Nueva visita
          </Button>
        }
      />

      {counters ? (
        <div className="mb-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t-4 border-ink pt-3 sm:flex">
          {(
            [
              ['Hoy', counters.today, false],
              ['Mañana', counters.tomorrow, false],
              ['Esta semana', counters.thisWeek, false],
              ['Atrasadas', counters.overdueScheduled, true],
            ] as const
          ).map(([label, value, alert]) => (
            <div key={label} className="flex-1 sm:border-l sm:border-rule sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
              <p className="label-caps">{label}</p>
              <p className={`num text-4xl font-extrabold leading-none ${alert && value > 0 ? 'text-red' : ''}`}>{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Tabs label="Vistas de la agenda" tabs={VIEWS.map((v) => ({ id: v.id, label: v.label }))} value={view} onChange={(id) => update({ view: id })} />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        {view !== 'proximas' ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => step(-1)}
              className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <Button variant="outline" onClick={() => update({ d: today })}>
              Hoy
            </Button>
            <button
              type="button"
              aria-label="Siguiente"
              onClick={() => step(1)}
              className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        {view === 'seguimiento' ? (
          <TrackingView month={monthOf(date)} />
        ) : visitsQuery.isLoading ? (
          <Loading />
        ) : visitsQuery.error ? (
          <ErrorNote message={errorMessage(visitsQuery.error)} onRetry={() => visitsQuery.refetch()} />
        ) : view === 'dia' ? (
          <DayView date={date} visits={visits} />
        ) : view === 'semana' ? (
          <WeekView date={date} visits={visits} onPickDay={(d) => update({ view: 'dia', d })} />
        ) : view === 'mes' ? (
          <MonthView date={date} visits={visits} onPickDay={(d) => update({ view: 'dia', d })} />
        ) : visits.length === 0 ? (
          <EmptyState title="No hay visitas programadas." />
        ) : (
          <UpcomingView visits={visits} />
        )}
      </div>
    </>
  );
}
