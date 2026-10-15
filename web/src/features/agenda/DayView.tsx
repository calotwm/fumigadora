import { useState } from 'react';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/display';
import { Select } from '../../ui/form';
import { useActions } from '../actions/ActionsProvider';
import type { Visit } from '../../lib/types';
import { VisitCard } from './VisitCard';

const UNASSIGNED = 'none';

export function DayView({ date, visits }: { date: string; visits: Visit[] }) {
  const { open } = useActions();
  const [filter, setFilter] = useState<string>('all');
  if (visits.length === 0) {
    return (
      <EmptyState
        title="No hay visitas para este día."
        action={
          <Button size="sm" variant="outline" onClick={() => open({ type: 'visit', date })}>
            Agendar visita
          </Button>
        }
      />
    );
  }

  // Employees that actually have visits this day, so the filter never offers an empty choice.
  const assignees = [...new Map(visits.filter((v) => v.assignedUserId !== null).map((v) => [v.assignedUserId!, v.assigneeName ?? ''])).entries()];
  const hasUnassigned = visits.some((v) => v.assignedUserId === null);
  const active = filter === 'all' || filter === UNASSIGNED || assignees.some(([id]) => String(id) === filter) ? filter : 'all';
  const shown = visits.filter((v) =>
    active === 'all' ? true : active === UNASSIGNED ? v.assignedUserId === null : String(v.assignedUserId) === active,
  );

  return (
    <>
      {assignees.length > 0 ? (
        <Select label="Empleado" value={active} onChange={(e) => setFilter(e.target.value)} wrapperClassName="mb-4 max-w-xs">
          <option value="all">Todos</option>
          {assignees.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {hasUnassigned ? <option value={UNASSIGNED}>Sin asignar</option> : null}
        </Select>
      ) : null}
      <ul className="border-t border-ink">
        {shown.map((visit) => (
          <VisitCard key={visit.id} visit={visit} />
        ))}
      </ul>
    </>
  );
}
