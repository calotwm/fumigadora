import { useId, useRef, useState, type FormEvent } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Field, MoneyInput } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { useLoadFuel } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { readTicketTotal } from '../../lib/ticketOcr';

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

/**
 * "Cargar nafta": photo of the ticket (camera on phones) and its amount. The amount is read from the photo on the
 * phone (OCR) and proposed; the employee always checks it and can type it.
 */
export function FuelSheet({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const load = useLoadFuel();
  const [amount, setAmount] = useState<number | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<'idle' | 'busy' | 'found' | 'none'>('idle');
  // Only the latest photo may fill the amount, and never over one the employee typed.
  const photoSeq = useRef(0);
  const typed = useRef(false);

  function pickPhoto(file: File | null) {
    setPhoto(file);
    const seq = ++photoSeq.current;
    if (!file) return setReading('idle');
    setReading('busy');
    readTicketTotal(file)
      .catch(() => null)
      .then((cents) => {
        if (seq !== photoSeq.current) return;
        if (cents === null) return setReading('none');
        if (!typed.current) setAmount(cents);
        setReading('found');
      });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!photo) return setError('Sacale una foto al ticket.');
    if (photo.size > MAX_BYTES) return setError('La foto supera los 10 MB.');
    if (amount === null || amount <= 0) return setError('Ingresá el importe del ticket.');
    setError(null);
    load.mutate(
      { amountCents: amount, photo },
      {
        onSuccess: () => {
          toast.success(`Carga registrada: ${money(amount)}`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Cargar nafta"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={load.isPending} className="flex-[2]">
            {load.isPending ? 'Enviando…' : 'Guardar'}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Foto del ticket" hint={photo ? photo.name : 'Se abre la cámara del teléfono.'}>
          {(id) => (
            <input
              id={id}
              type="file"
              accept={ACCEPT}
              capture="environment"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
              className="block w-full text-base file:mr-3 file:min-h-11 file:border file:border-ink file:bg-paper-2 file:px-3 file:font-semibold"
            />
          )}
        </Field>
        <div className="flex flex-col gap-1">
          <MoneyInput
            label="Importe"
            value={amount}
            onChange={(cents) => {
              typed.current = true;
              setAmount(cents);
            }}
            error={error}
          />
          <p aria-live="polite" className="text-sm text-muted">
            {reading === 'busy'
              ? 'Leyendo el importe del ticket…'
              : reading === 'found'
                ? 'Importe leído del ticket: revisá que coincida.'
                : reading === 'none'
                  ? 'No se pudo leer el importe: escribilo.'
                  : null}
          </p>
        </div>
      </form>
    </Sheet>
  );
}
