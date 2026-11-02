import { useId, useState, type FormEvent } from 'react';
import {
  useBaitStations,
  useDeleteBaitStation,
  useDeleteClientDocument,
  useSaveBaitStation,
  useUploadClientDocument,
  useUploadStationPhoto,
} from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate } from '../../lib/format';
import type { BaitStation, ClientDocument } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading, SectionHead } from '../../ui/display';
import { Field, Input } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/** "Cebaderos": the client's bait stations (code, where it is, photo) and PDF documents such as the plan. */
export function BaitStationsTab({ clientId }: { clientId: number }) {
  const { data, error, isLoading, refetch } = useBaitStations(clientId);
  const [editing, setEditing] = useState<BaitStation | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BaitStation | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<ClientDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const removeStation = useDeleteBaitStation();
  const removeDoc = useDeleteClientDocument();
  const toast = useToast();

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Cebaderos">
        <SectionHead title="Cebaderos" action={<Button size="sm" onClick={() => setEditing('new')}>Agregar cebadero</Button>} />
        {data.stations.length === 0 ? (
          <EmptyState title="Todavía no hay cebaderos cargados." />
        ) : (
          <ul className="border-t border-ink">
            {data.stations.map((s) => (
              <li key={s.id} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 border-b border-rule py-3">
                {s.hasPhoto ? (
                  <a href={`/api/bait-stations/${s.id}/photo`} target="_blank" rel="noreferrer">
                    <img src={`/api/bait-stations/${s.id}/photo`} alt={`Foto del cebadero ${s.code}`} loading="lazy" className="size-16 border border-rule object-cover" />
                  </a>
                ) : (
                  <span className="grid size-16 place-items-center border border-dashed border-rule text-xs text-muted">Sin foto</span>
                )}
                <div className="min-w-0">
                  <p className="font-bold">{s.code}</p>
                  <p className="text-sm text-muted">{s.reference || 'Sin referencia'}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(s)} aria-label={`Eliminar cebadero ${s.code}`}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Documentos">
        <SectionHead title="Documentos (PDF)" action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}>Subir PDF</Button>} />
        {data.documents.length === 0 ? (
          <EmptyState title="No hay documentos. Subí el plano de cebaderos si lo tenés." />
        ) : (
          <ul className="border-t border-ink">
            {data.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 border-b border-rule py-3">
                <a href={`/api/client-documents/${d.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold underline">
                  {d.name}
                </a>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{fullDate(d.createdAt.slice(0, 10))}</span>
                  <Button size="sm" variant="ghost" onClick={() => setDeletingDoc(d)} aria-label={`Eliminar ${d.name}`}>
                    Eliminar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? <StationSheet clientId={clientId} station={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {uploading ? <DocumentSheet clientId={clientId} onClose={() => setUploading(false)} /> : null}
      {deleting ? (
        <Confirm
          title="Eliminar cebadero"
          confirmLabel="Eliminar"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await removeStation.mutateAsync(deleting.id);
            toast.success('Cebadero eliminado');
          }}
        >
          <p>Se eliminará el cebadero {deleting.code} y su foto.</p>
        </Confirm>
      ) : null}
      {deletingDoc ? (
        <Confirm
          title="Eliminar documento"
          confirmLabel="Eliminar"
          onClose={() => setDeletingDoc(null)}
          onConfirm={async () => {
            await removeDoc.mutateAsync(deletingDoc.id);
            toast.success('Documento eliminado');
          }}
        >
          <p>Se eliminará {deletingDoc.name}.</p>
        </Confirm>
      ) : null}
    </div>
  );
}

function StationSheet({ clientId, station, onClose }: { clientId: number; station: BaitStation | null; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const save = useSaveBaitStation();
  const upload = useUploadStationPhoto();
  const [code, setCode] = useState(station?.code ?? '');
  const [reference, setReference] = useState(station?.reference ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = save.isPending || upload.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return setError('Indicá el número o código.');
    if (photo && photo.size > MAX_BYTES) return setError('La foto supera los 10 MB.');
    setError(null);
    try {
      const saved = await save.mutateAsync({ id: station?.id, body: { clientId, code: code.trim(), reference: reference.trim() } });
      if (photo) await upload.mutateAsync({ id: saved.id, photo });
      toast.success(station ? 'Cebadero actualizado' : 'Cebadero agregado');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Sheet
      title={station ? `Cebadero ${station.code}` : 'Agregar cebadero'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={pending} className="flex-[2]">
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Input label="Número o código" value={code} onChange={(e) => setCode(e.target.value)} error={error} autoFocus />
        <Input label="Dónde está (referencia)" value={reference} onChange={(e) => setReference(e.target.value)} hint="Por ejemplo: portón de entrada, lado izquierdo." />
        <Field label={station?.hasPhoto ? 'Reemplazar foto (opcional)' : 'Foto (opcional)'} hint={photo?.name}>
          {(id) => (
            <input
              id={id}
              type="file"
              accept={IMAGE_ACCEPT}
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="block w-full text-base file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper-2 file:px-3 file:font-semibold"
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}

function DocumentSheet({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const upload = useUploadClientDocument();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return setError('Elegí el PDF.');
    if (file.size > MAX_BYTES) return setError('El PDF supera los 10 MB.');
    setError(null);
    upload.mutate(
      { clientId, file, ...(name.trim() ? { name: name.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success('Documento subido');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Subir PDF"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={upload.isPending} className="flex-[2]">
            {upload.isPending ? 'Subiendo…' : 'Subir'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Archivo PDF" error={error}>
          {(id) => (
            <input
              id={id}
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-base file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper-2 file:px-3 file:font-semibold"
            />
          )}
        </Field>
        <Input label="Nombre (opcional)" value={name} onChange={(e) => setName(e.target.value)} hint="Por ejemplo: Plano de cebaderos." />
      </form>
    </Sheet>
  );
}
