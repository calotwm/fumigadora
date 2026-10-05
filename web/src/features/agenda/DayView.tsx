import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/display';
import { useActions } from '../actions/ActionsProvider';
import type { Visit } from '../../lib/types';
import { VisitCard } from './VisitCard';

export function DayView({ date, visits }: { date: string; visits: Visit[] }) {
  const { open } = useActions();
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
  return (
    <ul className="border-t border-ink">
      {visits.map((visit) => (
        <VisitCard key={visit.id} visit={visit} />
      ))}
    </ul>
  );
}
