import { Sheet } from '../../ui/Sheet';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { useMyVisitStations } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import type { MyVisit } from '../../lib/types';

/** Read-only list of the client's bait stations, so the technician can find them. */
export function MyStationsSheet({ visit, onClose }: { visit: MyVisit; onClose: () => void }) {
  const { data, error, isLoading, refetch } = useMyVisitStations(visit.id);
  return (
    <Sheet title={`Cebaderos · ${visit.clientName}`} onClose={onClose}>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data.stations.length === 0 ? (
        <EmptyState title="Este cliente no tiene cebaderos cargados." />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.stations.map((s) => (
            <li key={s.id} className="border-b border-rule pb-4">
              <p className="text-lg font-extrabold">{s.code}</p>
              {s.reference ? <p className="text-base">{s.reference}</p> : null}
              {s.hasPhoto ? (
                <a href={`/api/me/bait-stations/${s.id}/photo`} target="_blank" rel="noreferrer" className="mt-2 block">
                  <img
                    src={`/api/me/bait-stations/${s.id}/photo`}
                    alt={`Foto del cebadero ${s.code}`}
                    loading="lazy"
                    className="max-h-56 w-full border border-rule object-cover"
                  />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
