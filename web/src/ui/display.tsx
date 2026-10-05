import type { ReactNode } from 'react';

export function SectionHead({
  title,
  action,
  as: Tag = 'h2',
}: {
  title: string;
  action?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className="section-head flex items-baseline justify-between gap-4 mb-3">
      <Tag className="label-caps !text-ink">{title}</Tag>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 mb-6 md:mb-8">
      <div>
        {eyebrow ? <p className="label-caps mb-1">{eyebrow}</p> : null}
        <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="texture flex flex-wrap items-center justify-between gap-3 border border-dashed border-rule px-4 py-5">
      <p className="text-sm text-muted">{title}</p>
      {action}
    </div>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <p role="status" className="py-6 text-sm text-muted">
      {label}
    </p>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="border-l-4 border-red bg-paper-2 px-4 py-3 text-sm">
      <p className="font-semibold text-red">No se pudieron cargar los datos</p>
      <p className="text-muted">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-semibold uppercase tracking-wider underline">
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  delta?: ReactNode;
  tone?: 'default' | 'red';
  size?: 'lg' | 'md';
}

/**
 * Big numeral with a small caps label, optional sub-note and delta line.
 * The numeral scales with its own container (cqw) so long amounts never overflow; capped at the type scale.
 */
export function Stat({ label, value, note, delta, tone = 'default', size = 'lg' }: StatProps) {
  const cap = size === 'lg' ? 64 : 40;
  return (
    <div className="@container min-w-0">
      <p className="label-caps">{label}</p>
      <p
        className={`num font-extrabold tracking-tight leading-none mt-2 ${tone === 'red' ? 'text-red' : ''}`}
        style={{ fontSize: `clamp(22px, 14cqw, ${cap}px)` }}
      >
        {value}
      </p>
      {note ? <p className="mt-2 text-sm num">{note}</p> : null}
      {delta ? <p className="mt-1 text-xs text-muted num">{delta}</p> : null}
    </div>
  );
}

const TAGS: Record<string, { label: string; className: string }> = {
  paid: { label: 'Pagada', className: '!text-ink' },
  partial: { label: 'Parcial', className: '!text-ink' },
  pending: { label: 'Pendiente', className: '' },
  overdue: { label: 'Vencida', className: '!text-red' },
  void: { label: 'Anulada', className: 'line-through' },
};

/** Text-only status label. Overdue is the only red one. */
export function Tag({ status, children }: { status: string; children?: ReactNode }) {
  const tag = TAGS[status];
  return (
    <span className={`label-caps ${tag?.className ?? ''}`}>
      {children ?? tag?.label ?? status}
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** On mobile the cell is shown without its label (useful for the primary column). */
  primary?: boolean;
  /** Span the full row on mobile (for action buttons). */
  wide?: boolean;
  /** Hide the cell on mobile entirely. */
  hideOnMobile?: boolean;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /** Tailwind `grid-template-columns` class for md+ (e.g. `md:grid-cols-[2fr_1fr_1fr]`). */
  gridClass: string;
  /** Mobile column count of the stacked layout (literal class so Tailwind sees it). */
  mobileCols?: 'grid-cols-2' | 'grid-cols-3';
  onRowClick?: (row: T) => void;
  caption: string;
}

/** Grid table on desktop; each row collapses into a stacked block with inline labels on mobile. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  gridClass,
  mobileCols = 'grid-cols-2',
  onRowClick,
  caption,
}: TableProps<T>) {
  return (
    <div role="table" aria-label={caption} className="border-t border-ink">
      <div role="row" className={`hidden md:grid gap-4 py-2 border-b border-rule ${gridClass}`}>
        {columns.map((column) => (
          <div
            key={column.key}
            role="columnheader"
            className={`label-caps ${column.align === 'right' ? 'text-right' : ''}`}
          >
            {column.header}
          </div>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          role="row"
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={`grid ${mobileCols} gap-x-4 gap-y-2 py-3 border-b border-rule md:items-center ${gridClass} ${
            onRowClick ? 'cursor-pointer hover:bg-paper-2/70' : ''
          }`}
        >
          {columns.map((column) => (
            <div
              key={column.key}
              role="cell"
              className={`min-w-0 text-sm ${column.primary || column.wide ? 'col-span-full md:col-span-1' : ''} ${
                column.hideOnMobile ? 'hidden md:block' : ''
              } ${column.align === 'right' ? 'md:text-right' : ''}`}
            >
              {column.primary || !column.header ? null : (
                <span className="label-caps block md:hidden mb-0.5">{column.header}</span>
              )}
              {column.cell(row)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar flex gap-0 overflow-x-auto border-b border-rule -mx-4 px-4 md:mx-0 md:px-0">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={`relative min-h-11 px-4 text-sm font-semibold whitespace-nowrap ${
              active ? 'text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {active ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-red" /> : null}
          </button>
        );
      })}
    </div>
  );
}
