import { useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/form';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useAddMyVisitStation, useMyVisitStations } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import type { MyVisit } from '../../lib/types';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/** The client's bait stations, so the technician can find them, and a form to add a new one. */
export function MyStationsSheet({ visit, onClose }: { visit: MyVisit; onClose: () => void }) {
  const { data, error, isLoading, refetch } = useMyVisitStations(visit.id);
  const [adding, setAdding] = useState(false);
  return (
    <Sheet title={`Cebaderos · ${visit.clientName}`} onClose={onClose}>
      {adding ? (
        <AddStationForm visitId={visit.id} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)} className="mb-4 w-full">
          + Agregar cebadero
        </Button>
      )}
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

/** New station: number or code, where it is, and an optional photo (camera on phones). */
function AddStationForm({ visitId, onDone }: { visitId: number; onDone: () => void }) {
  const toast = useToast();
  const add = useAddMyVisitStation(visitId);
  const [code, setCode] = useState('');
  const [reference, setReference] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return setError('Indicá el número o código');
    if (photo && photo.size > MAX_BYTES) return setError('La foto supera los 10 MB.');
    setError(null);
    add.mutate(
      { code: code.trim(), reference: reference.trim(), photo },
      {
        onSuccess: (station) => {
          toast.success(`Cebadero ${station.code} agregado`);
          onDone();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 flex flex-col gap-4 border-b border-rule pb-6">
      <Input label="Número o código" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} error={error} autoFocus />
      <Input label="Ubicación" hint="Ej.: portón de entrada, lado izquierdo" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} />
      <Field label="Foto (opcional)" hint={photo ? photo.name : 'Se abre la cámara del teléfono.'}>
        {(id) => (
          <input
            id={id}
            type="file"
            accept={ACCEPT}
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-base file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper-2 file:px-3 file:font-semibold"
          />
        )}
      </Field>
      <p className="text-sm text-muted">Para cobrarlo, sumá el extra «Estación cebadera» al cerrar la visita.</p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onDone} className="flex-1">
          Cancelar
        </Button>
        <Button type="submit" disabled={add.isPending} className="flex-[2]">
          {add.isPending ? 'Guardando…' : 'Guardar cebadero'}
        </Button>
      </div>
    </form>
  );
}
