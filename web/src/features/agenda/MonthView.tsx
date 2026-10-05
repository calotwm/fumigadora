import { addDays, endOfMonth, endOfWeek, monthOf, startOfMonth, startOfWeek, today as todayIso } from '@fumigadora/shared';
import { longDate } from '../../lib/format';
import type { Visit } from '../../lib/types';

const HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Month grid with a count and dots per day; clicking a day opens the day view. */
export function MonthView({ date, visits, onPickDay }: { date: string; visits: Visit[]; onPickDay: (date: string) => void }) {
  const first = startOfWeek(startOfMonth(date));
  const last = endOfWeek(endOfMonth(date));
  const today = todayIso();
  const month = monthOf(date);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);

  const byDay = new Map<string, Visit[]>();
  for (const visit of visits) byDay.set(visit.date, [...(byDay.get(visit.date) ?? []), visit]);

  return (
    <div role="grid" aria-label="Calendario del mes" className="border-t border-ink">
      <div role="row" className="grid grid-cols-7 border-b border-rule">
        {HEADERS.map((h) => (
          <div key={h} role="columnheader" className="label-caps py-2 text-center">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = byDay.get(day) ?? [];
          const inMonth = monthOf(day) === month;
          const isToday = day === today;
          const pending = items.filter((v) => v.status === 'scheduled').length;
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              onClick={() => onPickDay(day)}
              aria-label={`${longDate(day)}: ${items.length} ${items.length === 1 ? 'visita' : 'visitas'}`}
              className={`flex min-h-14 flex-col items-center justify-start gap-1 border-b border-r border-rule p-1 hover:bg-paper-2 md:min-h-24 md:items-start md:p-2 ${
                inMonth ? '' : 'text-muted/60'
              } ${isToday ? 'bg-paper-2 shadow-[inset_0_3px_0_0_var(--color-ink)]' : ''}`}
            >
              <span className="num text-sm font-bold">{Number(day.slice(8, 10))}</span>
              {items.length > 0 ? (
                <>
                  <span className="hidden text-xs font-semibold md:block">
                    {items.length} {items.length === 1 ? 'visita' : 'visitas'}
                  </span>
                  <span className="flex flex-wrap justify-center gap-0.5">
                    {items.slice(0, 4).map((v) => (
                      <span key={v.id} aria-hidden className={`size-1.5 ${v.status === 'done' ? 'bg-rule' : 'bg-ink'}`} />
                    ))}
                  </span>
                  <span className="sr-only">{pending} pendientes</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
