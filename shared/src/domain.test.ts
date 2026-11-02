import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  agingBucket,
  allocatePayment,
  clientBalance,
  diffDays,
  endOfMonth,
  endOfWeek,
  formatMoney,
  invoiceState,
  invoiceStatus,
  isIsoDate,
  lastMonths,
  nextVisitDate,
  nextWorkingDay,
  parseMoney,
  pesosToCents,
  splitCents,
  startOfMonth,
  startOfWeek,
  today,
} from './index.js';

describe('money', () => {
  it('formats es-AR with thousands dots and decimal comma', () => {
    expect(formatMoney(123456789)).toBe('$ 1.234.567,89');
    expect(formatMoney(150000_00)).toBe('$ 150.000,00');
    expect(formatMoney(5)).toBe('$ 0,05');
    expect(formatMoney(0)).toBe('$ 0,00');
    expect(formatMoney(123400, { showCents: false })).toBe('$ 1.234');
  });

  it('groups 4-digit numbers (no es-AR minimum grouping quirk)', () => {
    expect(formatMoney(1234_00)).toBe('$ 1.234,00');
  });

  it('formats negatives', () => {
    expect(formatMoney(-123450)).toBe('-$ 1.234,50');
  });

  it('never produces float artifacts for large sums', () => {
    expect(formatMoney(124625087_19)).toBe('$ 124.625.087,19');
  });

  it('parses es-AR and plain input', () => {
    expect(parseMoney('150.000')).toBe(15_000_000);
    expect(parseMoney('150000,50')).toBe(15_000_050);
    expect(parseMoney('1.234.567,89')).toBe(123_456_789);
    expect(parseMoney('150000')).toBe(15_000_000);
    expect(parseMoney('$ 1.500')).toBe(150_000);
    expect(parseMoney('150.5')).toBe(15_050);
    expect(parseMoney('150,5')).toBe(15_050);
    expect(parseMoney('0,05')).toBe(5);
    expect(parseMoney(',5')).toBe(50);
    expect(parseMoney('-1.000,25')).toBe(-100_025);
  });

  it('rejects invalid input', () => {
    for (const bad of ['', ' ', 'abc', '1,2,3', '12.34.5', '1,234.5', '150,', '1,999,99', '10,123']) {
      expect(parseMoney(bad), bad).toBeNull();
    }
  });

  it('round trips formatMoney through parseMoney', () => {
    for (const cents of [0, 1, 99, 100, 12345, 150000_00, 123456789]) {
      expect(parseMoney(formatMoney(cents))).toBe(cents);
    }
  });

  it('splits cents exactly', () => {
    expect(splitCents(100, 3)).toEqual([34, 33, 33]);
    expect(splitCents(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('converts pesos to cents without drift', () => {
    expect(pesosToCents(1.005)).toBe(101);
    expect(pesosToCents(0.1 + 0.2)).toBe(30);
    expect(pesosToCents(19.99)).toBe(1999);
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2023-13-01')).toBe(false);
    expect(isIsoDate('2023-1-01')).toBe(false);
  });

  it('adds and diffs days across month and year boundaries', () => {
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2025-01-01', '2024-12-31')).toBe(1);
    expect(diffDays('2024-12-31', '2025-01-01')).toBe(-1);
    expect(diffDays('2024-03-01', '2024-02-01')).toBe(29);
  });

  it('computes month and week boundaries', () => {
    expect(startOfMonth('2024-02-17')).toBe('2024-02-01');
    expect(endOfMonth('2024-02-17')).toBe('2024-02-29');
    expect(endOfMonth('2023-02-17')).toBe('2023-02-28');
    // 2025-01-01 is a Wednesday.
    expect(startOfWeek('2025-01-01')).toBe('2024-12-30');
    expect(endOfWeek('2025-01-01')).toBe('2025-01-05');
    expect(startOfWeek('2024-12-30')).toBe('2024-12-30');
    expect(endOfWeek('2025-01-05')).toBe('2025-01-05');
  });

  it('lists last months oldest first across year boundary', () => {
    expect(lastMonths('2025-02', 4)).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('resolves today in the business timezone', () => {
    // 02:30 UTC on Jan 2 is still Jan 1 at 23:30 in Buenos Aires (UTC-3).
    expect(today(new Date('2025-01-02T02:30:00Z'))).toBe('2025-01-01');
    expect(today(new Date('2025-01-02T03:30:00Z'))).toBe('2025-01-02');
  });
});

describe('invoice status', () => {
  const inv = { amountCents: 100_00, dueOn: '2025-03-10' };

  it('is pending before due with nothing paid', () => {
    expect(invoiceStatus(inv, 0, '2025-03-10')).toBe('pending');
  });

  it('is overdue the day after due', () => {
    expect(invoiceStatus(inv, 0, '2025-03-11')).toBe('overdue');
  });

  it('is partial before due when partly paid', () => {
    expect(invoiceStatus(inv, 40_00, '2025-03-01')).toBe('partial');
  });

  it('overdue wins over partial but keeps the partial flag', () => {
    const state = invoiceState(inv, 40_00, '2025-03-20');
    expect(state.status).toBe('overdue');
    expect(state.isPartial).toBe(true);
    expect(state.balanceCents).toBe(60_00);
    expect(state.daysOverdue).toBe(10);
  });

  it('is paid when fully paid, even after due', () => {
    expect(invoiceStatus(inv, 100_00, '2026-01-01')).toBe('paid');
    expect(invoiceState(inv, 100_00, '2026-01-01').daysOverdue).toBe(0);
  });

  it('tolerates over-allocation without negative balance', () => {
    expect(invoiceState(inv, 150_00, '2025-03-01').balanceCents).toBe(0);
  });

  it('voided invoices are void with zero balance', () => {
    const state = invoiceState({ ...inv, voidedAt: new Date() }, 0, '2026-01-01');
    expect(state.status).toBe('void');
    expect(state.balanceCents).toBe(0);
    expect(state.daysOverdue).toBe(0);
  });
});

describe('aging', () => {
  it('buckets days overdue', () => {
    expect(agingBucket(-5)).toBe('current');
    expect(agingBucket(0)).toBe('current');
    expect(agingBucket(1)).toBe('1-30');
    expect(agingBucket(30)).toBe('1-30');
    expect(agingBucket(31)).toBe('31-60');
    expect(agingBucket(60)).toBe('31-60');
    expect(agingBucket(61)).toBe('61-90');
    expect(agingBucket(90)).toBe('61-90');
    expect(agingBucket(91)).toBe('90+');
  });
});

describe('clientBalance', () => {
  const t = '2025-06-30';

  it('sums open balances and finds the oldest overdue invoice', () => {
    const b = clientBalance(
      [
        { balanceCents: 100_00, dueOn: '2025-05-01' },
        { balanceCents: 50_00, dueOn: '2025-06-10' },
        { balanceCents: 70_00, dueOn: '2025-07-15' },
        { balanceCents: 0, dueOn: '2025-01-01' },
      ],
      0,
      t,
    );
    expect(b.openCents).toBe(220_00);
    expect(b.balanceCents).toBe(220_00);
    expect(b.overdueCents).toBe(150_00);
    expect(b.overdueInvoiceCount).toBe(2);
    expect(b.daysOverdue).toBe(60);
    expect(b.agingBucket).toBe('31-60');
  });

  it('is negative when the client only has credit', () => {
    const b = clientBalance([], 25_00, t);
    expect(b.balanceCents).toBe(-25_00);
    expect(b.overdueCents).toBe(0);
    expect(b.agingBucket).toBe('current');
  });

  it('applies credit to the oldest invoices before computing overdue', () => {
    const b = clientBalance(
      [
        { balanceCents: 100_00, dueOn: '2025-05-01' },
        { balanceCents: 50_00, dueOn: '2025-06-10' },
      ],
      120_00,
      t,
    );
    expect(b.balanceCents).toBe(30_00);
    expect(b.overdueCents).toBe(30_00);
    expect(b.daysOverdue).toBe(20);
  });

  it('has no overdue when everything is current', () => {
    const b = clientBalance([{ balanceCents: 10_00, dueOn: '2025-06-30' }], 0, t);
    expect(b.overdueCents).toBe(0);
    expect(b.daysOverdue).toBe(0);
  });
});

describe('allocatePayment', () => {
  const invoices = [
    { id: 3, balanceCents: 30_00, dueOn: '2025-03-01', issuedOn: '2025-02-19' },
    { id: 1, balanceCents: 100_00, dueOn: '2025-01-01', issuedOn: '2024-12-22' },
    { id: 2, balanceCents: 50_00, dueOn: '2025-02-01', issuedOn: '2025-01-22' },
  ];

  it('allocates FIFO by due date', () => {
    const r = allocatePayment(120_00, invoices);
    expect(r.allocations).toEqual([
      { invoiceId: 1, amountCents: 100_00 },
      { invoiceId: 2, amountCents: 20_00 },
    ]);
    expect(r.creditCents).toBe(0);
  });

  it('supports partial payment of the oldest invoice', () => {
    const r = allocatePayment(30_00, invoices);
    expect(r.allocations).toEqual([{ invoiceId: 1, amountCents: 30_00 }]);
    expect(r.creditCents).toBe(0);
  });

  it('turns overpayment into credit', () => {
    const r = allocatePayment(500_00, invoices);
    expect(r.allocations.reduce((s, a) => s + a.amountCents, 0)).toBe(180_00);
    expect(r.creditCents).toBe(320_00);
  });

  it('pays a chosen invoice first, then continues FIFO', () => {
    const r = allocatePayment(60_00, invoices, 3);
    expect(r.allocations).toEqual([
      { invoiceId: 3, amountCents: 30_00 },
      { invoiceId: 1, amountCents: 30_00 },
    ]);
  });

  it('only allocates to the chosen invoice when the amount does not exceed it', () => {
    const r = allocatePayment(10_00, invoices, 2);
    expect(r.allocations).toEqual([{ invoiceId: 2, amountCents: 10_00 }]);
  });

  it('pays the selected invoices first in chronological order, leaving older ones owed', () => {
    const r = allocatePayment(80_00, invoices, [3, 2]);
    expect(r.allocations).toEqual([
      { invoiceId: 2, amountCents: 50_00 },
      { invoiceId: 3, amountCents: 30_00 },
    ]);
    expect(r.creditCents).toBe(0);
  });

  it('sends the remainder over the selected invoices FIFO to the others, then to credit', () => {
    const r = allocatePayment(100_00, invoices, [3]);
    expect(r.allocations).toEqual([
      { invoiceId: 3, amountCents: 30_00 },
      { invoiceId: 1, amountCents: 70_00 },
    ]);
    expect(allocatePayment(200_00, invoices, [2]).creditCents).toBe(20_00);
  });

  it('keeps plain FIFO for an empty selection', () => {
    expect(allocatePayment(120_00, invoices, [])).toEqual(allocatePayment(120_00, invoices));
  });

  it('rejects a selection with an invoice that is not open', () => {
    expect(() => allocatePayment(10_00, invoices, [2, 99])).toThrow();
  });

  it('is all credit when there are no open invoices', () => {
    expect(allocatePayment(10_00, [])).toEqual({ allocations: [], creditCents: 10_00 });
  });

  it('rejects a target that is not open and invalid amounts', () => {
    expect(() => allocatePayment(10_00, invoices, 99)).toThrow();
    expect(() => allocatePayment(0, invoices)).toThrow();
    expect(() => allocatePayment(10.5, invoices)).toThrow();
  });

  it('breaks ties by issue date then id', () => {
    const r = allocatePayment(10_00, [
      { id: 5, balanceCents: 10_00, dueOn: '2025-01-01', issuedOn: '2024-12-25' },
      { id: 4, balanceCents: 10_00, dueOn: '2025-01-01', issuedOn: '2024-12-25' },
    ]);
    expect(r.allocations[0]?.invoiceId).toBe(4);
  });
});

describe('addMonths and nextVisitDate', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-03-31', 1)).toBe('2025-04-30');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2024-11-15', 3)).toBe('2025-02-15');
    expect(addMonths('2025-01-15', -2)).toBe('2024-11-15');
    expect(addMonths('2025-01-15', -13)).toBe('2023-12-15');
  });

  it('computes each frequency', () => {
    const d = '2025-01-31';
    expect(nextVisitDate(d, 'none')).toBeNull();
    expect(nextVisitDate(d, 'weekly')).toBe('2025-02-07');
    expect(nextVisitDate(d, 'biweekly')).toBe('2025-02-14');
    expect(nextVisitDate(d, 'monthly')).toBe('2025-02-28');
    expect(nextVisitDate(d, 'bimonthly')).toBe('2025-03-31');
    expect(nextVisitDate(d, 'quarterly')).toBe('2025-04-30');
    expect(nextVisitDate(d, 'semiannual')).toBe('2025-07-31');
    expect(nextVisitDate(d, 'yearly')).toBe('2026-01-31');
  });
});

describe('nextWorkingDay', () => {
  it('is the next day from Monday to Saturday and skips Sunday', () => {
    expect(nextWorkingDay('2025-06-15')).toBe('2025-06-16'); // Sunday -> Monday
    expect(nextWorkingDay('2025-06-13')).toBe('2025-06-14'); // Friday -> Saturday
    expect(nextWorkingDay('2025-06-14')).toBe('2025-06-16'); // Saturday -> Monday (Sunday skipped)
    expect(nextWorkingDay('2025-06-16')).toBe('2025-06-17');
  });
});
