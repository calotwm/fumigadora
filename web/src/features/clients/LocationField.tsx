import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Button } from '../../ui/Button';

interface GeocodeResult {
  latitude: number;
  longitude: number;
  label: string;
}

/** Client map location: looked up from the address (OpenStreetMap) so the client shows on the route map. */
export function LocationField({
  address,
  latitude,
  longitude,
  onChange,
}: {
  address: string;
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number | null, longitude: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const located = latitude !== null && longitude !== null;

  function lookup() {
    setBusy(true);
    setError(null);
    api<GeocodeResult>('/clients/geocode', { query: { q: address.trim() } })
      .then((result) => {
        onChange(result.latitude, result.longitude);
        setFound(result.label);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="border border-rule px-3 py-3">
      <p className="label-caps">Ubicación en el mapa</p>
      {located ? (
        <p className="mt-1 text-sm">
          <span className="num">
            {latitude.toFixed(5)}, {longitude.toFixed(5)}
          </span>{' '}
          <a
            className="underline"
            href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver en Google Maps
          </a>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">Sin ubicación: no aparece en el mapa del recorrido.</p>
      )}
      {found ? <p className="mt-1 text-xs text-muted">Encontrada: {found}. Revisá que sea el lugar correcto.</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={<MapPin size={14} aria-hidden />}
          disabled={busy || address.trim().length < 3}
          onClick={lookup}
        >
          {busy ? 'Buscando…' : located ? 'Volver a buscar por dirección' : 'Buscar por dirección'}
        </Button>
        {located ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(null, null);
              setFound(null);
            }}
          >
            Quitar ubicación
          </Button>
        ) : null}
      </div>
    </div>
  );
}
