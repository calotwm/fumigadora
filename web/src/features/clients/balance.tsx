import type { AgingBucket } from '@fumigadora/shared';
import { money, overdueLabel } from '../../lib/format';
import type { BalanceFields } from '../../lib/types';

export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Corriente',
  '1-30': '1 a 30 días',
  '31-60': '31 a 60 días',
  '61-90': '61 a 90 días',
  '90+': 'Más de 90 días',
};

/** Compact balance cell: amount plus an overdue/"Al día" line. Red only when something is overdue. */
export function BalanceCell({ balance }: { balance: BalanceFields }) {
  const owes = balance.balanceCents > 0;
  const overdue = balance.overdueCents > 0 && balance.daysOverdue > 0;
  return (
    <div className="num">
      <p className={`font-extrabold ${overdue ? 'text-red' : ''} ${owes ? '' : 'text-muted'}`}>
        {balance.balanceCents < 0 ? `A favor ${money(-balance.balanceCents)}` : money(balance.balanceCents)}
      </p>
      <p className={`text-xs ${overdue ? 'font-semibold text-red' : 'text-muted'}`}>
        {overdue ? overdueLabel(balance.daysOverdue) : 'Al día'}
      </p>
    </div>
  );
}
