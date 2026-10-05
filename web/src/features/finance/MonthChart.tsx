import type { FinanceFigures } from '../../lib/types';
import { money } from '../../lib/format';

const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Compact es-AR axis amount: `$ 1,2 M`, `$ 450 mil`. */
export function compactMoney(cents: number): string {
  const pesos = cents / 100;
  if (pesos >= 1_000_000) return `$ ${(pesos / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} M`;
  if (pesos >= 1_000) return `$ ${Math.round(pesos / 1_000)} mil`;
  return `$ ${Math.round(pesos)}`;
}

function niceMax(value: number): number {
  if (value <= 0) return 100_00;
  const pesos = value / 100;
  const pow = 10 ** Math.floor(Math.log10(pesos));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= pesos) ?? pow * 10;
  return Math.ceil(pesos / step) * step * 100;
}

/** Hand-rolled SVG grouped bars: income (black) vs expenses (red) for the last months. */
export function MonthChart({ series }: { series: FinanceFigures[] }) {
  const W = 640;
  const H = 260;
  const left = 56;
  const bottom = 28;
  const top = 12;
  const max = niceMax(Math.max(...series.flatMap((s) => [s.incomeCents, s.expensesCents]), 0));
  const plotH = H - top - bottom;
  const plotW = W - left - 8;
  const group = plotW / Math.max(series.length, 1);
  const bar = Math.min(28, group / 3);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const y = (value: number) => top + plotH - (value / max) * plotH;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="chart-title" className="block w-full">
        <title id="chart-title">Ingresos y gastos de los últimos meses</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 8} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-rule)" strokeWidth={t === 0 ? 2 : 1} />
            <text x={left - 8} y={y(max * t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="num">
              {compactMoney(max * t)}
            </text>
          </g>
        ))}
        {series.map((item, index) => {
          const x = left + group * index + group / 2;
          const label = MONTH_SHORT[Number(item.month.slice(5, 7)) - 1] ?? item.month;
          return (
            <g key={item.month}>
              <rect x={x - bar - 1} y={y(item.incomeCents)} width={bar} height={Math.max(plotH - (y(item.incomeCents) - top), 0)} fill="var(--color-ink)">
                <title>{`${label}: ingresos ${money(item.incomeCents)}`}</title>
              </rect>
              <rect x={x + 1} y={y(item.expensesCents)} width={bar} height={Math.max(plotH - (y(item.expensesCents) - top), 0)} fill="var(--color-red)">
                <title>{`${label}: gastos ${money(item.expensesCents)}`}</title>
              </rect>
              <text x={x} y={H - 8} textAnchor="middle" fontSize={12} fontWeight={index === series.length - 1 ? 700 : 400} fill="var(--color-ink)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex gap-5 text-xs">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 bg-ink" /> Ingresos
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-3 bg-red" /> Gastos
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Ingresos y gastos por mes</caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Ingresos</th>
            <th>Gastos</th>
          </tr>
        </thead>
        <tbody>
          {series.map((item) => (
            <tr key={item.month}>
              <td>{item.month}</td>
              <td>{money(item.incomeCents)}</td>
              <td>{money(item.expensesCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
