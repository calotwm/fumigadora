import { addDays, isoWeekday, monthRange, startOfWeek } from './dates.js';
import type { IsoDate, IsoMonth } from './types.js';

/** A client that still needs `needed` services (not yet done and not yet scheduled) in the month. */
export interface RoutePlanClient {
  clientId: number;
  name: string;
  /** Zone (client `area`); null/empty = no zone, grouped last. */
  zone: string | null;
  /** Services still missing this month: weekly up to 5, biweekly up to 2, every other plan 1. */
  needed: number;
  frequency: string;
}

export interface RoutePlanOptions {
  /** First date that may be proposed (inclusive), e.g. tomorrow. Defaults to the first day of the month. */
  earliest?: IsoDate;
  /** Soft cap of visits per day; a full day pushes the visit to the next working day with room. Default 12. */
  maxPerDay?: number;
}

export interface PlannedRouteItem {
  clientId: number;
  date: IsoDate;
  zone: string | null;
}

export const DEFAULT_MAX_PER_DAY = 12;

const zoneKey = (zone: string | null) => (zone && zone.trim() !== '' ? zone.trim() : null);
const compareZones = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'es');

/** Monday-Friday dates of `month` from `earliest` on. */
export function workingDays(month: IsoMonth, earliest?: IsoDate): IsoDate[] {
  const { from, to } = monthRange(month);
  const days: IsoDate[] = [];
  for (let d = earliest && earliest > from ? earliest : from; d <= to; d = addDays(d, 1)) {
    if (isoWeekday(d) <= 5) days.push(d);
  }
  return days;
}

/**
 * Proposes the visit dates of a month route. Pure and deterministic (same input, same output).
 *
 * 1. Candidate days are the Monday-Friday dates of the month from `earliest`, grouped by ISO week.
 * 2. Every zone gets one home weekday (Mon-Fri). Zones are taken from the heaviest (most services) to the lightest,
 *    ties by name, and each goes to the weekday with the least load so far (ties: earlier weekday). So a zone is
 *    always visited on the same weekday, and the weekdays stay balanced. "No zone" is handled as one more zone.
 * 3. Frequencies decide which weeks a client is visited, on its zone's weekday:
 *    - weekly: one visit in each available week (the last `needed` weeks);
 *    - biweekly: weeks 1 and 3 of the available weeks (with 3 weeks or fewer, the first two);
 *    - monthly and longer plans: one visit, in the zone's home week (zones spread across the weeks in name order).
 *    If the zone's weekday does not exist in a week (month edge or `earliest`), the closest available working day
 *    of that week is used (ties: the earlier one).
 * 4. Clients are placed zone by zone, then by name. When the target day already holds `maxPerDay` visits, the visit
 *    moves to the next working day with room (later days first, wrapping to earlier ones); if every day is full it stays.
 */
export function planMonthRoute(month: IsoMonth, clients: RoutePlanClient[], options: RoutePlanOptions = {}): PlannedRouteItem[] {
  const days = workingDays(month, options.earliest);
  if (days.length === 0) return [];
  const maxPerDay = options.maxPerDay ?? DEFAULT_MAX_PER_DAY;

  const weeks = new Map<IsoDate, IsoDate[]>();
  for (const day of days) {
    const key = startOfWeek(day);
    weeks.set(key, [...(weeks.get(key) ?? []), day]);
  }
  const weekList = [...weeks.values()];

  const active = clients.filter((c) => c.needed > 0);
  const load = new Map<string | null, number>();
  for (const c of active) load.set(zoneKey(c.zone), (load.get(zoneKey(c.zone)) ?? 0) + c.needed);
  const zones = [...load.keys()].sort(compareZones);

  const weekdayLoad = [0, 0, 0, 0, 0];
  const weekdayOf = new Map<string | null, number>();
  const byWeight = [...zones].sort((a, b) => load.get(b)! - load.get(a)! || compareZones(a, b));
  for (const zone of byWeight) {
    let best = 0;
    for (let i = 1; i < 5; i++) if (weekdayLoad[i]! < weekdayLoad[best]!) best = i;
    weekdayOf.set(zone, best + 1);
    weekdayLoad[best]! += load.get(zone)!;
  }

  const dayFor = (week: IsoDate[], weekday: number): IsoDate =>
    week.reduce((best, d) => (Math.abs(isoWeekday(d) - weekday) < Math.abs(isoWeekday(best) - weekday) ? d : best), week[0]!);

  const counts = new Map<IsoDate, number>();
  const place = (target: IsoDate): IsoDate => {
    const start = days.indexOf(target);
    for (let step = 0; step < days.length; step++) {
      const candidate = days[(start + step) % days.length]!;
      if ((counts.get(candidate) ?? 0) < maxPerDay) return candidate;
    }
    return target;
  };

  const ordered = [...active].sort(
    (a, b) => compareZones(zoneKey(a.zone), zoneKey(b.zone)) || a.name.localeCompare(b.name, 'es') || a.clientId - b.clientId,
  );
  const result: PlannedRouteItem[] = [];
  for (const client of ordered) {
    const zone = zoneKey(client.zone);
    const weekday = weekdayOf.get(zone)!;
    const homeWeek = zones.indexOf(zone) % weekList.length;
    let weekIndexes: number[];
    if (client.frequency === 'weekly') {
      // The last weeks: a partial first week (month starting mid-week) is the one dropped when a service is already done.
      weekIndexes = weekList.map((_, i) => i).slice(-client.needed);
    } else if (client.frequency === 'biweekly') {
      const slots = weekList.length >= 4 ? [0, 2] : [0, 1];
      weekIndexes = slots.filter((i) => i < weekList.length);
      // When only one service is missing it takes the last slot still available.
      if (client.needed < weekIndexes.length) weekIndexes = weekIndexes.slice(weekIndexes.length - client.needed);
    } else {
      weekIndexes = [homeWeek];
    }
    for (const index of weekIndexes) {
      const date = place(dayFor(weekList[index]!, weekday));
      counts.set(date, (counts.get(date) ?? 0) + 1);
      result.push({ clientId: client.clientId, date, zone });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || compareZones(a.zone, b.zone) || a.clientId - b.clientId);
}

export interface RouteGroupable {
  date: IsoDate;
  zone: string | null;
}

/** Groups items by zone (named zones A-Z, "no zone" last), then by date. */
export function groupRouteItems<T extends RouteGroupable>(
  items: T[],
): { zone: string | null; count: number; dates: { date: IsoDate; items: T[] }[] }[] {
  const zones = new Map<string | null, Map<IsoDate, T[]>>();
  for (const item of items) {
    const key = zoneKey(item.zone);
    const byDate = zones.get(key) ?? new Map<IsoDate, T[]>();
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
    zones.set(key, byDate);
  }
  return [...zones.keys()].sort(compareZones).map((zone) => {
    const byDate = zones.get(zone)!;
    const dates = [...byDate.keys()].sort().map((date) => ({ date, items: byDate.get(date)! }));
    return { zone, count: dates.reduce((n, d) => n + d.items.length, 0), dates };
  });
}

export const NOTICE_MODES = ['on_approve', 'days_before'] as const;
export type NoticeMode = (typeof NOTICE_MODES)[number];

/** Date on which a service notice is due: on approval, or `daysBefore` days before the visit (never in the past). */
export function noticeDueDate(mode: NoticeMode, visitDate: IsoDate, today: IsoDate, daysBefore: number): IsoDate {
  if (mode === 'on_approve') return today;
  const due = addDays(visitDate, -daysBefore);
  return due < today ? today : due;
}
