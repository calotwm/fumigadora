import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { addDays, startOfWeek, today as todayIso } from '@fumigadora/shared';
import { longDate } from '../../lib/format';
import { useActions } from '../actions/ActionsProvider';
import type { Visit } from '../../lib/types';

const SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** Seven columns Monday-Sunday on desktop; stacked days on mobile. */
export function WeekView({ date, visits, onPickDay }: { date: string; visits: Visit[]; onPickDay: (date: string) => void }) {
  const { open } = useActions();
  const start = startOfWeek(date);
  const today = todayIso();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid border-t border-ink md:grid-cols-7 md:border-l md:border-rule">
      {days.map((day, index) => {
        const items = visits.filter((v) => v.date === day);
        const isToday = day === today;
        return (
          <section
            key={day}
            aria-label={longDate(day)}
            className={`min-w-0 border-b border-rule py-3 md:min-h-56 md:border-r md:px-2 ${isToday ? 'bg-paper-2' : ''}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => onPickDay(day)} className="min-h-8 text-left hover:underline">
                <span className="label-caps !text-ink">{SHORT[index]}</span>{' '}
                <span className="num text-xl font-extrabold">{Number(day.slice(8, 10))}</span>
              </button>
              <button
                type="button"
                aria-label={`Agendar visita el ${longDate(day)}`}
                onClick={() => open({ type: 'visit', date: day })}
                className="grid size-11 place-items-center text-muted hover:bg-paper hover:text-ink md:size-8"
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted">Sin visitas</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((visit) => (
                  <li key={visit.id} className={`border-l-4 pl-2 ${visit.status === 'done' ? 'border-rule text-muted' : 'border-ink'}`}>
                    <p className="num text-xs font-semibold">{visit.time ?? 'Sin hora'}</p>
                    <Link to={`/clientes/${visit.clientId}`} className="block text-sm font-bold leading-tight hover:underline">
                      {visit.clientName}
                    </Link>
                    <p className="text-xs text-muted">{visit.serviceTypeName}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
