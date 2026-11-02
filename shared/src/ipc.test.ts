import { describe, expect, it } from 'vitest';
import type { DebtByMonth } from './debtMonths.js';
import { ipcInterestCents, withIpcUpdate } from './ipc.js';

const rates = [
  { month: '2026-03', percentBp: 340 },
  { month: '2026-04', percentBp: 260 },
  { month: '2026-05', percentBp: 210 },
];

describe('ipcInterestCents', () => {
  it('compounds the monthly IPC of every published month after the due month', () => {
    // 1.026 * 1.021 = 1.047546 -> 4.7546% of $1.000,00
    expect(ipcInterestCents(100_000, '2026-03-15', rates)).toBe(4_755);
  });

  it('is zero when no IPC was published after the due month', () => {
    expect(ipcInterestCents(100_000, '2026-05-10', rates)).toBe(0);
    expect(ipcInterestCents(100_000, '2026-03-15', [])).toBe(0);
  });

  it('is zero for nothing owed', () => {
    expect(ipcInterestCents(0, '2026-01-10', rates)).toBe(0);
  });
});

describe('withIpcUpdate', () => {
  const debt: DebtByMonth = {
    creditCents: 0,
    totalOwedCents: 150_000,
    months: [
      {
        month: '2026-03',
        billedCents: 100_000,
        paidCents: 0,
        creditAppliedCents: 0,
        owedCents: 100_000,
        invoices: [{ id: 1, number: 'A', issuedOn: '2026-03-01', dueOn: '2026-03-15', description: '', amountCents: 100_000, paidCents: 0, balanceCents: 100_000 }],
      },
      {
        month: '2026-06',
        billedCents: 50_000,
        paidCents: 0,
        creditAppliedCents: 0,
        owedCents: 50_000,
        invoices: [{ id: 2, number: 'B', issuedOn: '2026-06-01', dueOn: '2026-06-30', description: '', amountCents: 50_000, paidCents: 0, balanceCents: 50_000 }],
      },
    ],
  };

  it('adds the IPC update per month and the total owed updated to the last published IPC', () => {
    const result = withIpcUpdate(debt, rates, '2026-07-01');
    expect(result.months.map((m) => m.ipcCents)).toEqual([4_755, 0]);
    expect(result.ipc).toEqual({ throughMonth: '2026-05', totalCents: 4_755, updatedOwedCents: 154_755 });
  });

  it('runs from the latest due date of the month and skips debt not yet due', () => {
    const month = { ...debt.months[0]!, invoices: [...debt.months[0]!.invoices, { ...debt.months[0]!.invoices[0]!, id: 3, dueOn: '2026-04-20' }] };
    expect(withIpcUpdate({ ...debt, months: [month] }, rates, '2026-07-01').months[0]!.ipcCents).toBe(2_100);
    expect(withIpcUpdate(debt, rates, '2026-03-10').months[0]!.ipcCents).toBe(0);
  });

  it('reports no IPC month when there are no rates', () => {
    expect(withIpcUpdate(debt, [], '2026-07-01').ipc).toEqual({ throughMonth: null, totalCents: 0, updatedOwedCents: 150_000 });
  });
});
