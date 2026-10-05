import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { useClients, useUnarchiveClient, type ClientListParams } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { KIND_LABELS, dayMonth } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Chips } from '../../ui/form';
import { EmptyState, ErrorNote, Loading, PageHeader, Table, type Column } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useActions } from '../actions/ActionsProvider';
import type { ClientListItem } from '../../lib/types';
import { BalanceCell } from './balance';

const FILTERS: { value: ClientListParams['filter']; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'debt', label: 'Con deuda' },
  { value: 'overdue', label: 'Vencidos' },
  { value: 'archived', label: 'Archivados' },
];

const SORTS: { value: ClientListParams['sort']; label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'balance', label: 'Saldo' },
  { value: 'overdue', label: 'Antigüedad' },
];

function parseParam<T extends string>(value: string | null, allowed: { value: T }[], fallback: T): T {
  return allowed.find((option) => option.value === value)?.value ?? fallback;
}

export function ClientsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { open } = useActions();
  const toast = useToast();
  const unarchive = useUnarchiveClient();
  const filter = parseParam(params.get('f'), FILTERS, 'all');
  const sort = parseParam(params.get('s'), SORTS, 'name');
  const search = params.get('q') ?? '';
  const [text, setText] = useState(search);
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

  // Debounce typing into the URL (the query source of truth), so back navigation restores it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setParamsRef.current(
        (current) => {
          const next = new URLSearchParams(current);
          if (text.trim()) next.set('q', text);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  function setParam(key: 'f' | 's', value: string, fallback: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  const { data, error, isLoading, refetch } = useClients({ search, filter, sort });

  const columns: Column<ClientListItem>[] = [
    {
      key: 'name',
      header: 'Cliente',
      primary: true,
      cell: (c) => (
        <div className="min-w-0">
          <Link to={`/clientes/${c.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-base font-bold hover:underline">
            {c.name}
          </Link>
          <p className="truncate text-xs text-muted">
            {KIND_LABELS[c.kind] ?? c.kind}
            {c.area ? ` · ${c.area}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'balance', header: 'Saldo', cell: (c) => <BalanceCell balance={c} /> },
    {
      key: 'next',
      header: 'Próxima visita',
      cell: (c) =>
        c.nextVisit ? (
          <span className="num">
            <span className="font-semibold">{dayMonth(c.nextVisit.date)}</span>
            <span className="block truncate text-xs text-muted">{c.nextVisit.serviceTypeName}</span>
          </span>
        ) : (
          <span className="text-muted">Sin programar</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) =>
        c.archived ? (
          <Button
            size="sm"
            variant="outline"
            disabled={unarchive.isPending}
            onClick={(e) => {
              e.stopPropagation();
              unarchive.mutate(c.id, { onSuccess: () => toast.success(`Cliente restaurado: ${c.name}`) });
            }}
          >
            Restaurar
          </Button>
        ) : c.balanceCents > 0 ? (
          <Button
            size="sm"
            variant="accent"
            onClick={(e) => {
              e.stopPropagation();
              open({ type: 'payment', clientId: c.id });
            }}
          >
            Cobrar
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={data ? `${data.length} ${data.length === 1 ? 'cliente' : 'clientes'}` : undefined}
        title="Clientes"
        actions={
          <Button icon={<Plus size={16} aria-hidden />} onClick={() => open({ type: 'client' })}>
            Nuevo cliente
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="client-search" className="label-caps">
            Buscar
          </label>
          <div className="relative">
            <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="client-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Nombre, dirección o teléfono"
              className="block min-h-11 w-full rounded-sm border border-ink bg-paper pl-9 pr-3 text-base placeholder:text-muted/70"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="client-sort" className="label-caps">
            Ordenar por
          </label>
          <select
            id="client-sort"
            value={sort}
            onChange={(e) => setParam('s', e.target.value, 'name')}
            className="block min-h-11 w-full rounded-sm border border-ink bg-paper px-3 text-base md:w-48"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <Chips label="Filtro" value={filter} options={FILTERS} onChange={(value) => setParam('f', value, 'all')} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
      ) : data && data.length > 0 ? (
        <Table
          caption="Clientes"
          columns={columns}
          rows={data}
          rowKey={(c) => c.id}
          gridClass="md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_96px]"
          onRowClick={(c) => navigate(`/clientes/${c.id}`)}
        />
      ) : (
        <EmptyState
          title={search || filter !== 'all' ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes cargados.'}
          action={
            <Button size="sm" variant="outline" onClick={() => open({ type: 'client' })}>
              Nuevo cliente
            </Button>
          }
        />
      )}
    </>
  );
}
