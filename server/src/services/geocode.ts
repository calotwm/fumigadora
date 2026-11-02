import { AppError } from '../http.js';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Full address as the geocoder understood it, so the user can check it is the right place. */
  label: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Nominatim's usage policy asks for an identifying User-Agent. */
const USER_AGENT = 'Plagamix gestion (fumigadora)';

/**
 * Coordinates of an address in Argentina using OpenStreetMap's Nominatim (free, about one request per second).
 * Returns null when nothing matches; throws a 502 when the service fails.
 */
export async function geocodeAddress(fetchFn: typeof fetch, query: string): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'ar' });
  let res: Response;
  try {
    res = await fetchFn(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es' },
    });
  } catch {
    throw new AppError(502, 'geocode_unavailable', 'No se pudo consultar el mapa. Probá de nuevo en un rato.');
  }
  if (!res.ok) throw new AppError(502, 'geocode_unavailable', 'No se pudo consultar el mapa. Probá de nuevo en un rato.');
  const rows = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const latitude = Number(first?.lat);
  const longitude = Number(first?.lon);
  if (!first || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, label: first.display_name ?? query };
}
