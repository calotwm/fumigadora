import { describe, expect, it } from 'vitest';
import { isoWeekday, startOfWeek } from './dates.js';
import { reminderDecision } from './reminders.js';
import { groupRouteItems, noticeDueDate, planMonthRoute, workingDays, type RoutePlanClient } from './routePlan.js';

const client = (clientId: number, zone: string | null, frequency: string, needed: number, name = `C${String(clientId).padStart(2, '0')}`): RoutePlanClient => ({
  clientId,
  name,
  zone,
  frequency,
  needed,
});

describe('workingDays', () => {
  it('lists Monday to Friday only and honours earliest', () => {
    const days = workingDays('2025-06');
    expect(days[0]).toBe('2025-06-02');
    expect(days.every((d) => isoWeekday(d) <= 5)).toBe(true);
    expect(workingDays('2025-06', '2025-06-27')).toEqual(['2025-06-27', '2025-06-30']);
    expect(workingDays('2025-06', '2025-07-02')).toEqual([]);
  });
});

describe('planMonthRoute', () => {
  it('visits every client of a zone on the same weekday and spreads zones across weekdays', () => {
    const clients = [
      ...[1, 2, 3, 4].map((id) => client(id, 'Norte', 'monthly', 1)),
      ...[5, 6, 7].map((id) => client(id, 'Sur', 'monthly', 1)),
      client(8, 'Centro', 'monthly', 1),
    ];
    const plan = planMonthRoute('2025-06', clients);
    expect(plan).toHaveLength(8);
    const weekdaysByZone = new Map<string | null, Set<number>>();
    for (const item of plan) weekdaysByZone.set(item.zone, (weekdaysByZone.get(item.zone) ?? new Set()).add(isoWeekday(item.date)));
    for (const set of weekdaysByZone.values()) expect(set.size).toBe(1);
    const weekdays = [...weekdaysByZone.values()].map((s) => [...s][0]);
    expect(new Set(weekdays).size).toBe(3); // three zones, three different weekdays
  });

  it('weekly clients get one visit per week, biweekly weeks 1 and 3, monthly one', () => {
    const plan = planMonthRoute('2025-06', [client(1, 'Norte', 'weekly', 5), client(2, 'Norte', 'biweekly', 2), client(3, 'Norte', 'monthly', 1)]);
    const dates = (id: number) => plan.filter((p) => p.clientId === id).map((p) => p.date);
    expect(dates(1)).toHaveLength(5);
    expect(new Set(dates(1).map(startOfWeek)).size).toBe(5);
    expect(dates(2).map(startOfWeek)).toEqual(['2025-06-02', '2025-06-16']);
    expect(dates(3)).toHaveLength(1);
  });

  it('skips clients that need nothing (already done or scheduled)', () => {
    const plan = planMonthRoute('2025-06', [client(1, 'Norte', 'monthly', 0), client(2, 'Norte', 'monthly', 1)]);
    expect(plan.map((p) => p.clientId)).toEqual([2]);
  });

  it('never proposes dates before earliest and puts a single missing biweekly service in the later slot', () => {
    const plan = planMonthRoute('2025-06', [client(1, 'Sur', 'biweekly', 1)], { earliest: '2025-06-10' });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.date >= '2025-06-10').toBe(true);
    expect(planMonthRoute('2025-06', [client(1, 'Sur', 'monthly', 1)], { earliest: '2025-07-01' })).toEqual([]);
  });

  it('caps the visits per day', () => {
    const clients = Array.from({ length: 10 }, (_, i) => client(i + 1, 'Norte', 'monthly', 1));
    const plan = planMonthRoute('2025-06', clients, { maxPerDay: 4 });
    const perDay = new Map<string, number>();
    for (const p of plan) perDay.set(p.date, (perDay.get(p.date) ?? 0) + 1);
    expect(plan).toHaveLength(10);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(4);
  });

  it('is deterministic and puts clients without zone last', () => {
    const clients = [client(1, null, 'monthly', 1), client(2, 'Norte', 'monthly', 1)];
    expect(planMonthRoute('2025-06', clients)).toEqual(planMonthRoute('2025-06', [...clients].reverse()));
    expect(groupRouteItems(planMonthRoute('2025-06', clients)).map((g) => g.zone)).toEqual(['Norte', null]);
  });
});

describe('noticeDueDate', () => {
  it('is today on approval and N days before otherwise, never in the past', () => {
    expect(noticeDueDate('on_approve', '2025-06-20', '2025-06-10', 7)).toBe('2025-06-10');
    expect(noticeDueDate('days_before', '2025-06-20', '2025-06-10', 7)).toBe('2025-06-13');
    expect(noticeDueDate('days_before', '2025-06-12', '2025-06-10', 7)).toBe('2025-06-10');
  });
});

describe('reminderDecision', () => {
  const rules = { enabled: true, everyDays: 15, minDaysOverdue: 10 };
  const base = { email: 'a@example.com', overdueCents: 10_000, daysOverdue: 12, lastReminderOn: null };
  it('sends when every condition holds', () => {
    expect(reminderDecision(base, rules, '2025-06-15')).toEqual({ send: true });
  });
  it('respects the switch, the email, the debt and the threshold', () => {
    expect(reminderDecision(base, { ...rules, enabled: false }, '2025-06-15')).toEqual({ send: false, reason: 'disabled' });
    expect(reminderDecision({ ...base, email: null }, rules, '2025-06-15')).toEqual({ send: false, reason: 'no_email' });
    expect(reminderDecision({ ...base, overdueCents: 0 }, rules, '2025-06-15')).toEqual({ send: false, reason: 'not_overdue' });
    expect(reminderDecision({ ...base, daysOverdue: 9 }, rules, '2025-06-15')).toEqual({ send: false, reason: 'not_late_enough' });
    expect(reminderDecision({ ...base, daysOverdue: 10 }, rules, '2025-06-15')).toEqual({ send: true });
  });
  it('waits the configured interval since the last reminder', () => {
    expect(reminderDecision({ ...base, lastReminderOn: '2025-06-01' }, rules, '2025-06-15')).toEqual({ send: false, reason: 'too_recent' });
    expect(reminderDecision({ ...base, lastReminderOn: '2025-05-31' }, rules, '2025-06-15')).toEqual({ send: true });
  });
});
