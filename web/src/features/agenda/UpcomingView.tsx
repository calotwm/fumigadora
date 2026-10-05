import { addDays, endOfWeek, today as todayIso } from '@fumigadora/shared';
import type { Visit } from '../../lib/types';
import { VisitCard } from './VisitCard';

const GROUPS = ['Atrasadas', 'Hoy', 'Mañana', 'Esta semana', 'Próxima semana', 'Más adelante'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(date: string, today: string): Group {
  const weekEnd = endOfWeek(today);
  if (date < today) return 'Atrasadas';
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  if (date <= weekEnd) return 'Esta semana';
  if (date <= addDays(weekEnd, 7)) return 'Próxima semana';
  return 'Más adelante';
}

/** Scheduled visits grouped by proximity. Past scheduled visits show first, in red. */
export function UpcomingView({ visits }: { visits: Visit[] }) {
  const today = todayIso();
  const sorted = [...visits].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => {
        const items = sorted.filter((v) => groupOf(v.date, today) === group);
        if (items.length === 0) return null;
        const late = group === 'Atrasadas';
        return (
          <section key={group} aria-label={group}>
            <div className={`mb-1 flex items-baseline gap-3 border-t-4 pt-2 ${late ? 'border-red' : 'border-ink'}`}>
              <h3 className={`label-caps ${late ? '!text-red' : '!text-ink'}`}>{group}</h3>
              <span className={`num text-sm font-bold ${late ? 'text-red' : ''}`}>{items.length}</span>
            </div>
            <ul>
              {items.map((visit) => (
                <VisitCard key={visit.id} visit={visit} showDate />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
