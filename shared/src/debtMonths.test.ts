import { describe, expect, it } from 'vitest';
import { clientBalance, debtByMonth, invoiceMonth, type MonthInvoiceInput } from './index.js';

const inv = (over: Partial<MonthInvoiceInput> & Pick<MonthInvoiceInput, 'id'>): MonthInvoiceInput => ({
  number: `2025-${String(over.id).padStart(4, '0')}`,
  issuedOn: '2025-03-01',
  dueOn: '2025-03-11',
  periodMonth: null,
  description: '',
  amountCents: 100_00,
  paidCents: 0,
  ...over,
});

describe('invoiceMonth', () => {
  it('uses the billing period, falling back to the issue month', () => {
    expect(invoiceMonth({ periodMonth: '2025-02', issuedOn: '2025-03-01' })).toBe('2025-02');
    expect(invoiceMonth({ periodMonth: null, issuedOn: '2025-03-28' })).toBe('2025-03');
  });
});

describe('debtByMonth', () => {
  const invoices = [
    inv({ id: 1, periodMonth: '2025-03', issuedOn: '2025-03-01', dueOn: '2025-03-11', amountCents: 100_00, paidCents: 40_00 }),
    inv({ id: 2, periodMonth: '2025-04', issuedOn: '2025-04-01', dueOn: '2025-04-11', amountCents: 100_00 }),
    // Visit invoice without period: grouped by its issue month (April).
    inv({ id: 3, issuedOn: '2025-04-20', dueOn: '2025-04-30', amountCents: 30_00 }),
    inv({ id: 4, periodMonth: '2025-05', issuedOn: '2025-05-01', dueOn: '2025-05-11', amountCents: 100_00 }),
    // Fully paid: not part of the debt.
    inv({ id: 5, periodMonth: '2025-02', issuedOn: '2025-02-01', dueOn: '2025-02-11', amountCents: 100_00, paidCents: 100_00 }),
  ];

  it('groups three owed months, oldest first, with billed, paid and owed', () => {
    const r = debtByMonth(invoices);
    expect(r.months.map((m) => m.month)).toEqual(['2025-03', '2025-04', '2025-05']);
    expect(r.months[0]).toMatchObject({ billedCents: 100_00, paidCents: 40_00, creditAppliedCents: 0, owedCents: 60_00 });
    expect(r.months[1]).toMatchObject({ billedCents: 130_00, paidCents: 0, owedCents: 130_00 });
    expect(r.months[1]!.invoices.map((i) => i.id)).toEqual([2, 3]);
    expect(r.months[1]!.invoices[1]).toMatchObject({ balanceCents: 30_00 });
    expect(r.months[2]).toMatchObject({ owedCents: 100_00 });
    expect(r.totalOwedCents).toBe(290_00);
    expect(r.creditCents).toBe(0);
  });

  it('total equals the client balance', () => {
    const open = invoices.map((i) => ({ balanceCents: i.amountCents - i.paidCents, dueOn: i.dueOn }));
    expect(debtByMonth(invoices).totalOwedCents).toBe(clientBalance(open, 0, '2025-06-01').balanceCents);
    expect(debtByMonth(invoices, 70_00).totalOwedCents).toBe(clientBalance(open, 70_00, '2025-06-01').balanceCents);
  });

  it('nets unallocated credit oldest month first', () => {
    const r = debtByMonth(invoices, 70_00);
    expect(r.months[0]).toMatchObject({ creditAppliedCents: 60_00, owedCents: 0 });
    expect(r.months[1]).toMatchObject({ creditAppliedCents: 10_00, owedCents: 120_00 });
    expect(r.totalOwedCents).toBe(220_00);
  });

  it('keeps the credit left over when it exceeds the debt', () => {
    const r = debtByMonth([inv({ id: 1, amountCents: 50_00 })], 80_00);
    expect(r.totalOwedCents).toBe(0);
    expect(r.creditCents).toBe(30_00);
  });

  it('returns no months without open invoices', () => {
    expect(debtByMonth([])).toEqual({ months: [], totalOwedCents: 0, creditCents: 0 });
  });
});
