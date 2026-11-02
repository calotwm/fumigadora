import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { directionsLinks, orderDayRoute, type GeoPoint } from '@fumigadora/shared';
import { longDate } from '../../lib/format';
import type { RouteItem } from '../../lib/types';
import { AnchorButton } from '../../ui/Button';
import { Select } from '../../ui/form';
import { LazyStopsMap as StopsMap, type MapStop } from '../../ui/LazyStopsMap';

/** One colour per zone, in zone order; repeats after eight zones. */
const ZONE_COLORS = ['#e10600', '#1f6feb', '#2da44e', '#8250df', '#d1661c', '#bf4b8a', '#0a7c86', '#6b6b68'];
const NO_ZONE = 'Sin zona';

const zoneOf = (item: RouteItem) => item.zone ?? NO_ZONE;
const located = (item: RouteItem) => item.latitude !== null && item.longitude !== null;

/**
 * Map of the month route: every visit as a pin coloured by zone. Picking a zone and a day numbers the stops in
 * driving order (from the company base) and offers the Google Maps directions for that day.
 */
export function RouteMap({ items, base }: { items: RouteItem[]; base: GeoPoint | null }) {
  const zones = useMemo(
    () => [...new Set(items.map(zoneOf))].sort((a, b) => (a === NO_ZONE ? 1 : b === NO_ZONE ? -1 : a.localeCompare(b, 'es'))),
    [items],
  );
  const [zone, setZone] = useState('');
  const [date, setDate] = useState('');
  const colorOf = (z: string) => ZONE_COLORS[Math.max(zones.indexOf(z), 0) % ZONE_COLORS.length]!;

  const inZone = zone ? items.filter((i) => zoneOf(i) === zone) : items;
  const dates = [...new Set(inZone.map((i) => i.date))].sort();
  const activeDate = dates.includes(date) ? date : '';
  // A single day of a single zone is a real trip: number the stops in the order they will be done.
  const trip = zone !== '' && activeDate !== '';

  const { ordered, missing, stops } = useMemo(() => {
    const visible = activeDate ? inZone.filter((i) => i.date === activeDate) : inZone;
    const inOrder = trip
      ? orderDayRoute(
          visible.map((i) => ({ ...i, clientLatitude: i.latitude, clientLongitude: i.longitude })),
          base,
        )
      : visible;
    const pins: MapStop[] = inOrder.filter(located).map((item, index) => ({
      key: item.id,
      latitude: item.latitude!,
      longitude: item.longitude!,
      color: colorOf(zoneOf(item)),
      label: trip ? String(index + 1) : '',
      title: item.clientName,
      details: [item.address ?? '', `${zoneOf(item)} · ${longDate(item.date)}${item.time ? ` ${item.time}` : ''}`].filter(Boolean),
    }));
    return { ordered: inOrder, missing: visible.filter((i) => !located(i)), stops: pins };
  }, [items, zone, activeDate, base, zones]);
  const links = trip ? directionsLinks(ordered, base) : [];

  return (
    <section aria-label="Mapa del recorrido" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <Select label="Zona" value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Todas las zonas</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-64">
          <Select label="Día" value={activeDate} onChange={(e) => setDate(e.target.value)}>
            <option value="">Todos los días</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {longDate(d)}
              </option>
            ))}
          </Select>
        </div>
        {links.map((link) => (
          <AnchorButton key={link.url} size="sm" variant="accent" href={link.url} target="_blank" rel="noreferrer">
            {link.label} en Google Maps
          </AnchorButton>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Colores por zona">
        {zones.map((z) => (
          <li key={z} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: colorOf(z) }} />
            {z}
          </li>
        ))}
        {base ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 border border-ink bg-yellow" />
            Base
          </li>
        ) : null}
      </ul>
      {!trip ? <p className="text-xs text-muted">Elegí una zona y un día para ver el orden de las paradas y abrir el recorrido.</p> : null}
      <StopsMap stops={stops} base={base} path={trip ? colorOf(zone) : null} />
      {missing.length > 0 ? (
        <p className="border-l-4 border-yellow bg-paper-2 px-3 py-2 text-sm">
          {missing.length === 1 ? '1 visita no aparece' : `${missing.length} visitas no aparecen`} en el mapa porque el cliente no tiene
          ubicación:{' '}
          {missing.map((i, index) => (
            <span key={i.id}>
              {index > 0 ? ', ' : ''}
              <Link to={`/clientes/${i.clientId}`} className="underline">
                {i.clientName}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}
