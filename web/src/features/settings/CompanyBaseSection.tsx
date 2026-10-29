import { useEffect, useState, type FormEvent } from 'react';
import { useSaveSettings, useSettings } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { Button } from '../../ui/Button';
import { ErrorNote, Loading, SectionHead } from '../../ui/display';
import { Input } from '../../ui/form';
import { useToast } from '../../ui/Toast';

/** Parses "-34,6037" or "-34.6037"; null when empty or not a number. */
function coordinate(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
}

/** Ajustes > Base de la empresa: where the employees' day route starts (address and coordinates typed by the owner). */
export function CompanyBaseSection() {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setAddress(settings.data.companyAddress ?? '');
    setLatitude(settings.data.companyLatitude === null ? '' : String(settings.data.companyLatitude));
    setLongitude(settings.data.companyLongitude === null ? '' : String(settings.data.companyLongitude));
  }, [settings.data]);

  if (settings.isLoading) return <Loading />;
  if (settings.error || !settings.data) return <ErrorNote message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />;

  function fillFromDevice() {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
      },
      () => setError('No se pudo obtener la ubicación de este dispositivo.'),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const lat = coordinate(latitude);
    const lng = coordinate(longitude);
    if ((lat === null) !== (lng === null)) return setError('Completá latitud y longitud, o dejá las dos vacías.');
    if (lat !== null && (lat < -90 || lat > 90)) return setError('La latitud debe estar entre -90 y 90.');
    if (lng !== null && (lng < -180 || lng > 180)) return setError('La longitud debe estar entre -180 y 180.');
    setError(null);
    save.mutate(
      { companyAddress: address.trim() || null, companyLatitude: lat, companyLongitude: lng },
      {
        onSuccess: () => toast.success('Base guardada'),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <section aria-label="Base de la empresa">
      <SectionHead title="Base de la empresa" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Desde acá arranca el recorrido del día de cada empleado. Sin coordenadas, el recorrido empieza por la primera visita que tenga ubicación.
        </p>
        <Input label="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Latitud" inputMode="decimal" placeholder="-34.6037" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
          <Input label="Longitud" inputMode="decimal" placeholder="-58.3816" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="outline" onClick={fillFromDevice}>
            Usar mi ubicación
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </section>
  );
}
