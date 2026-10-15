import { describe, expect, it } from 'vitest';
import { expectedServicesInMonth, monthlyTrackingStatus, mondaysInMonth, suggestServiceDate } from './tracking.js';

describe('mondaysInMonth', () => {
  it('counts 4 or 5 Mondays', () => {
    expect(mondaysInMonth('2025-06')).toBe(5); // 2, 9, 16, 23, 30
    expect(mondaysInMonth('2025-02')).toBe(4);
    expect(mondaysInMonth('2025-09')).toBe(5); // starts on a Monday
    expect(mondaysInMonth('2024-02')).toBe(4); // leap year
  });
});

describe('expectedServicesInMonth', () => {
  it('does not track none', () => {
    expect(expectedServicesInMonth('none', '2025-06')).toBe(0);
  });

  it('weekly follows the Mondays of the month', () => {
    expect(expectedServicesInMonth('weekly', '2025-06')).toBe(5);
    expect(expectedServicesInMonth('weekly', '2025-02')).toBe(4);
  });

  it('biweekly is 2 and monthly is 1', () => {
    expect(expectedServicesInMonth('biweekly', '2025-06')).toBe(2);
    expect(expectedServicesInMonth('monthly', '2025-02')).toBe(1);
  });

  it('long frequencies are expected when never done', () => {
    for (const f of ['bimonthly', 'quarterly', 'semiannual', 'yearly'] as const) {
      expect(expectedServicesInMonth(f, '2025-06')).toBe(1);
      expect(expectedServicesInMonth(f, '2025-06', null)).toBe(1);
    }
  });

  it('bimonthly is due two months after the last service', () => {
    expect(expectedServicesInMonth('bimonthly', '2025-06', '2025-04-20')).toBe(1);
    expect(expectedServicesInMonth('bimonthly', '2025-06', '2025-05-02')).toBe(0);
    // due date 2025-06-30 is the last day of the month: still due.
    expect(expectedServicesInMonth('bimonthly', '2025-06', '2025-04-30')).toBe(1);
    // due 2025-07-01: not this month.
    expect(expectedServicesInMonth('bimonthly', '2025-06', '2025-05-01')).toBe(0);
  });

  it('quarterly, semiannual and yearly respect their interval', () => {
    expect(expectedServicesInMonth('quarterly', '2025-06', '2025-03-31')).toBe(1);
    expect(expectedServicesInMonth('quarterly', '2025-06', '2025-04-01')).toBe(0);
    expect(expectedServicesInMonth('semiannual', '2025-06', '2024-12-15')).toBe(1);
    expect(expectedServicesInMonth('semiannual', '2025-06', '2025-01-15')).toBe(0);
    expect(expectedServicesInMonth('yearly', '2025-06', '2024-06-10')).toBe(1);
    expect(expectedServicesInMonth('yearly', '2025-06', '2024-07-10')).toBe(0);
  });

  it('overdue services stay expected in later months', () => {
    expect(expectedServicesInMonth('quarterly', '2025-12', '2025-03-01')).toBe(1);
  });

  it('crosses year boundaries and clamps short months', () => {
    expect(expectedServicesInMonth('quarterly', '2025-01', '2024-10-31')).toBe(1);
    expect(expectedServicesInMonth('quarterly', '2025-01', '2024-11-01')).toBe(0);
    // Dec 31 + 2 months clamps to Feb 28: due in Feb, not before.
    expect(expectedServicesInMonth('bimonthly', '2025-02', '2024-12-31')).toBe(1);
    expect(expectedServicesInMonth('bimonthly', '2025-01', '2024-12-31')).toBe(0);
  });
});

describe('monthlyTrackingStatus', () => {
  const base = { frequency: 'monthly', month: '2025-06', today: '2025-06-15' } as const;

  it('pending and unscheduled when nothing happened', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: ['2025-05-10'], scheduledDates: [] });
    expect(s).toMatchObject({
      expected: 1,
      done: 0,
      scheduled: 0,
      pending: 1,
      pendingUnscheduled: 1,
      isDue: true,
      lastDoneOn: '2025-05-10',
      daysSinceLast: 36,
    });
  });

  it('scheduled visits cover the pending part', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: [], scheduledDates: ['2025-06-20'] });
    expect(s).toMatchObject({ pending: 1, scheduled: 1, pendingUnscheduled: 0, isDue: true });
    expect(s.lastDoneOn).toBeNull();
    expect(s.daysSinceLast).toBeNull();
  });

  it('ignores scheduled visits outside the month', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: [], scheduledDates: ['2025-07-01', '2025-05-31'] });
    expect(s.scheduled).toBe(0);
    expect(s.pendingUnscheduled).toBe(1);
  });

  it('is complete once the expected services are done', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: ['2025-06-03'], scheduledDates: ['2025-06-25'] });
    expect(s).toMatchObject({ expected: 1, done: 1, pending: 0, scheduled: 0, pendingUnscheduled: 0, isDue: false });
    expect(s.daysSinceLast).toBe(12);
  });

  it('caps done at expected', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: ['2025-06-01', '2025-06-10'], scheduledDates: [] });
    expect(s.done).toBe(1);
  });

  it('weekly: partially done with the rest scheduled', () => {
    const s = monthlyTrackingStatus({
      frequency: 'weekly',
      month: '2025-06',
      today: '2025-06-15',
      doneDates: ['2025-06-02', '2025-06-09'],
      scheduledDates: ['2025-06-16', '2025-06-23'],
    });
    expect(s).toMatchObject({ expected: 5, done: 2, pending: 3, scheduled: 2, pendingUnscheduled: 1 });
  });

  it('bimonthly done this month is complete, not "not due"', () => {
    const s = monthlyTrackingStatus({
      frequency: 'bimonthly',
      month: '2025-06',
      today: '2025-06-15',
      doneDates: ['2025-04-10', '2025-06-12'],
      scheduledDates: [],
    });
    expect(s).toMatchObject({ expected: 1, done: 1, pending: 0, isDue: false });
  });

  it('bimonthly not yet due has nothing expected', () => {
    const s = monthlyTrackingStatus({
      frequency: 'bimonthly',
      month: '2025-06',
      today: '2025-06-15',
      doneDates: ['2025-05-20'],
      scheduledDates: [],
    });
    expect(s).toMatchObject({ expected: 0, pending: 0, isDue: false, lastDoneOn: '2025-05-20' });
  });

  it('none is not tracked', () => {
    const s = monthlyTrackingStatus({ ...base, frequency: 'none', doneDates: [], scheduledDates: [] });
    expect(s).toMatchObject({ expected: 0, isDue: false });
  });

  it('ignores done dates in the future (relative to today)', () => {
    const s = monthlyTrackingStatus({ ...base, doneDates: ['2025-06-20'], scheduledDates: [] });
    expect(s.done).toBe(0);
  });

  it('works for a past month', () => {
    const s = monthlyTrackingStatus({
      frequency: 'monthly',
      month: '2025-05',
      today: '2025-06-15',
      doneDates: ['2025-05-31'],
      scheduledDates: [],
    });
    expect(s).toMatchObject({ expected: 1, done: 1, isDue: false, daysSinceLast: 15 });
  });
});

describe('suggestServiceDate', () => {
  it('proposes the next weekday in the current month', () => {
    expect(suggestServiceDate('2025-06', '2025-06-12')).toBe('2025-06-13'); // Thu -> Fri
    expect(suggestServiceDate('2025-06', '2025-06-13')).toBe('2025-06-16'); // Fri -> Mon
  });

  it('clamps to the last weekday of the month', () => {
    expect(suggestServiceDate('2025-06', '2025-06-30')).toBe('2025-06-30'); // Mon: month over after today -> last weekday
    expect(suggestServiceDate('2025-05', '2025-05-30')).toBe('2025-05-30'); // Fri 30, next weekdays are in June
  });

  it('uses the first weekday of a future month and nothing for a past month', () => {
    expect(suggestServiceDate('2025-07', '2025-06-15')).toBe('2025-07-01');
    expect(suggestServiceDate('2025-11', '2025-06-15')).toBe('2025-11-03'); // Nov 1 is a Saturday
    expect(suggestServiceDate('2025-05', '2025-06-15')).toBeNull();
  });
});
