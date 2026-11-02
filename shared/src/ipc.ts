import { monthOf } from './dates.js';
import type { DebtByMonth, DebtMonth } from './debtMonths.js';
import type { IsoDate, IsoMonth } from './types.js';

/** Monthly IPC (INDEC, nivel general) variation; `percentBp` in basis points (1.9% = 190). */
export interface IpcRate {
  month: IsoMonth;
  percentBp: number;
}

/**
 * What a debt grows when updated by IPC: the monthly variations of every published month after the due month,
 * compounded. Rounded to the cent; zero when nothing is owed or no later month is published yet.
 */
export function ipcInterestCents(owedCents: number, dueOn: IsoDate, rates: IpcRate[]): number {
  if (owedCents <= 0) return 0;
  const dueMonth = monthOf(dueOn);
  const factor = rates.filter((r) => r.month > dueMonth).reduce((f, r) => f * (1 + r.percentBp / 10_000), 1);
  return Math.round(owedCents * (factor - 1));
}

export interface DebtMonthWithIpc extends DebtMonth {
  /** IPC update of `owedCents` (0 while not overdue). */
  ipcCents: number;
}

export interface DebtByMonthWithIpc extends Omit<DebtByMonth, 'months'> {
  months: DebtMonthWithIpc[];
  ipc: {
    /** Last published IPC month used; null when no IPC is known. */
    throughMonth: IsoMonth | null;
    totalCents: number;
    /** totalOwedCents + totalCents. */
    updatedOwedCents: number;
  };
}

/**
 * Debt by month updated to the last published IPC. Each month runs from its latest due date (the conservative
 * choice when it groups several invoices); months not overdue on `today` are not updated.
 */
export function withIpcUpdate(debt: DebtByMonth, rates: IpcRate[], today: IsoDate): DebtByMonthWithIpc {
  const months = debt.months.map((m) => {
    const dueOn = m.invoices.reduce((latest, i) => (i.dueOn > latest ? i.dueOn : latest), '');
    return { ...m, ipcCents: dueOn && dueOn < today ? ipcInterestCents(m.owedCents, dueOn, rates) : 0 };
  });
  const totalCents = months.reduce((s, m) => s + m.ipcCents, 0);
  const throughMonth = rates.reduce<IsoMonth | null>((last, r) => (last === null || r.month > last ? r.month : last), null);
  return { ...debt, months, ipc: { throughMonth, totalCents, updatedOwedCents: debt.totalOwedCents + totalCents } };
}
