export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** What the day route needs to know about a visit. Coordinates are the client's; null when unknown. */
export interface DayRouteVisit {
  id: number;
  /** `HH:MM`, or null when the visit has no fixed time. */
  time: string | null;
  clientLatitude: number | null;
  clientLongitude: number | null;
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function visitPoint(v: Pick<DayRouteVisit, 'clientLatitude' | 'clientLongitude'>): GeoPoint | null {
  return v.clientLatitude !== null && v.clientLongitude !== null
    ? { latitude: v.clientLatitude, longitude: v.clientLongitude }
    : null;
}

/**
 * Order in which to do a day's visits. Pure and deterministic.
 *
 * 1. Visits with a fixed time come first, by time (ties by id).
 * 2. The rest are chained nearest-neighbour: from `base` (the company's location) go to the closest remaining visit,
 *    then from there to the next closest, and so on. Without a base the route starts at the first of them that has
 *    coordinates (lowest id).
 * 3. Visits whose client has no coordinates go last, by id.
 */
export function orderDayRoute<T extends DayRouteVisit>(visits: T[], base: GeoPoint | null): T[] {
  const timed = visits.filter((v) => v.time !== null).sort((a, b) => a.time!.localeCompare(b.time!) || a.id - b.id);
  const untimed = visits.filter((v) => v.time === null).sort((a, b) => a.id - b.id);
  const located = untimed.filter((v) => visitPoint(v) !== null);
  const unlocated = untimed.filter((v) => visitPoint(v) === null);

  const chained: T[] = [];
  const remaining = [...located];
  let from: GeoPoint | null = base;
  while (remaining.length > 0) {
    let best = 0;
    if (from !== null) {
      let bestKm = Infinity;
      remaining.forEach((v, i) => {
        const km = haversineKm(from!, visitPoint(v)!);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      });
    }
    const [next] = remaining.splice(best, 1);
    chained.push(next!);
    from = visitPoint(next!);
  }
  return [...timed, ...chained, ...unlocated];
}

/** A place to drive to: coordinates when known, otherwise the address text. */
export interface RouteStop {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface DirectionsLink {
  /** "Recorrido 1/2", or "Recorrido" when everything fits in one link. */
  label: string;
  url: string;
  /** Stops covered by this link. */
  stops: number;
}

/** Google Maps accepts about 10 stops per directions link (9 waypoints and the destination). */
export const MAX_STOPS_PER_LINK = 10;

const stopText = (s: RouteStop): string | null =>
  s.latitude !== null && s.longitude !== null ? `${s.latitude},${s.longitude}` : s.address?.trim() || null;

/**
 * Google Maps directions links for the stops in order, starting at `origin` (the base; without it Maps uses the
 * phone's location). Long days are split into chunks of `MAX_STOPS_PER_LINK`; each chunk starts where the previous ended.
 * Stops without coordinates or address are skipped.
 */
export function directionsLinks(stops: RouteStop[], origin: GeoPoint | null, maxStops = MAX_STOPS_PER_LINK): DirectionsLink[] {
  const texts = stops.map(stopText).filter((t): t is string => t !== null);
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += maxStops) chunks.push(texts.slice(i, i + maxStops));
  let start: string | null = origin ? `${origin.latitude},${origin.longitude}` : null;
  return chunks.map((chunk, index) => {
    const params = new URLSearchParams({ api: '1', travelmode: 'driving', destination: chunk[chunk.length - 1]! });
    if (start) params.set('origin', start);
    if (chunk.length > 1) params.set('waypoints', chunk.slice(0, -1).join('|'));
    start = chunk[chunk.length - 1]!;
    return {
      label: chunks.length === 1 ? 'Recorrido' : `Recorrido ${index + 1}/${chunks.length}`,
      url: `https://www.google.com/maps/dir/?${params.toString()}`,
      stops: chunk.length,
    };
  });
}
