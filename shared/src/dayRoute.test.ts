import { describe, expect, it } from 'vitest';
import { directionsLinks, haversineKm, orderDayRoute, type DayRouteVisit } from './index.js';

const v = (id: number, time: string | null, lat: number | null, lng: number | null): DayRouteVisit => ({
  id,
  time,
  clientLatitude: lat,
  clientLongitude: lng,
});
const ids = (list: DayRouteVisit[]) => list.map((x) => x.id);

// Points along a line east of the base (Obelisco, CABA): farther id = farther away.
const BASE = { latitude: -34.6037, longitude: -58.3816 };
const at = (km: number) => ({ lat: -34.6037, lng: -58.3816 + km / 91.5 });

describe('haversineKm', () => {
  it('measures a known distance', () => {
    // Obelisco -> Plaza Italia is about 4.9 km.
    expect(haversineKm(BASE, { latitude: -34.5809, longitude: -58.4211 })).toBeCloseTo(4.8, 0);
    expect(haversineKm(BASE, BASE)).toBe(0);
  });
});

describe('orderDayRoute', () => {
  it('puts timed visits first by time, then chains the rest nearest-neighbour from the base', () => {
    const list = [
      v(1, null, at(9).lat, at(9).lng),
      v(2, '11:00', at(1).lat, at(1).lng),
      v(3, null, at(2).lat, at(2).lng),
      v(4, '09:30', at(30).lat, at(30).lng),
      v(5, null, at(5).lat, at(5).lng),
    ];
    expect(ids(orderDayRoute(list, BASE))).toEqual([4, 2, 3, 5, 1]);
  });

  it('chains from the last chosen stop, not always from the base', () => {
    // From the base, B (west 3 km) is closer than A (east 4 km); then from B, C (west 9 km) beats A (7 km east of B)...
    const west = (km: number) => ({ lat: -34.6037, lng: -58.3816 - km / 91.5 });
    const list = [v(1, null, at(4).lat, at(4).lng), v(2, null, west(3).lat, west(3).lng), v(3, null, west(9).lat, west(9).lng)];
    expect(ids(orderDayRoute(list, BASE))).toEqual([2, 3, 1]);
  });

  it('sends visits without coordinates last, in id order', () => {
    const list = [v(7, null, null, null), v(2, null, at(3).lat, at(3).lng), v(5, null, null, 1), v(3, '08:00', null, null)];
    expect(ids(orderDayRoute(list, BASE))).toEqual([3, 2, 5, 7]);
  });

  it('starts at the first visit with coordinates when there is no base', () => {
    const list = [v(3, null, at(8).lat, at(8).lng), v(1, null, at(1).lat, at(1).lng), v(2, null, at(2).lat, at(2).lng)];
    expect(ids(orderDayRoute(list, null))).toEqual([1, 2, 3]);
  });

  it('is deterministic, does not mutate its input and handles empty days', () => {
    const list = [v(2, null, at(2).lat, at(2).lng), v(1, null, at(1).lat, at(1).lng)];
    const copy = [...list];
    expect(ids(orderDayRoute(list, BASE))).toEqual(ids(orderDayRoute([...list].reverse(), BASE)));
    expect(list).toEqual(copy);
    expect(orderDayRoute([], BASE)).toEqual([]);
  });
});

describe('directionsLinks', () => {
  const stop = (n: number) => ({ latitude: Number((-34.6 - n / 1000).toFixed(4)), longitude: -58.4, address: null });

  it('builds one link with the base as origin, the last stop as destination and the rest as waypoints', () => {
    const [link, ...rest] = directionsLinks([stop(1), stop(2), stop(3)], BASE);
    expect(rest).toEqual([]);
    expect(link!.label).toBe('Recorrido');
    expect(link!.stops).toBe(3);
    const url = new URL(link!.url);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('origin')).toBe('-34.6037,-58.3816');
    expect(url.searchParams.get('destination')).toBe('-34.603,-58.4');
    expect(url.searchParams.get('waypoints')).toBe('-34.601,-58.4|-34.602,-58.4');
  });

  it('splits long days into chunks of 10 stops, each starting where the previous ended', () => {
    const links = directionsLinks(Array.from({ length: 23 }, (_, i) => stop(i + 1)), BASE);
    expect(links.map((l) => [l.label, l.stops])).toEqual([
      ['Recorrido 1/3', 10],
      ['Recorrido 2/3', 10],
      ['Recorrido 3/3', 3],
    ]);
    const first = new URL(links[0]!.url).searchParams;
    const second = new URL(links[1]!.url).searchParams;
    expect(first.get('waypoints')!.split('|')).toHaveLength(9);
    expect(second.get('origin')).toBe(first.get('destination'));
  });

  it('uses the address when there are no coordinates, skips empty stops and works without an origin', () => {
    const links = directionsLinks(
      [
        { latitude: null, longitude: null, address: 'Av. Corrientes 1234, CABA' },
        { latitude: null, longitude: null, address: null },
        { latitude: -34.6, longitude: -58.4, address: 'ignored' },
      ],
      null,
    );
    expect(links).toHaveLength(1);
    const p = new URL(links[0]!.url).searchParams;
    expect(p.has('origin')).toBe(false);
    expect(p.get('waypoints')).toBe('Av. Corrientes 1234, CABA');
    expect(p.get('destination')).toBe('-34.6,-58.4');
    expect(directionsLinks([], BASE)).toEqual([]);
  });
});
