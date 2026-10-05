import { useEffect, useId, useState } from 'react';
import { useClientSearch } from '../../lib/queries';
import { KIND_LABELS } from '../../lib/format';
import type { SearchClient } from '../../lib/types';

function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Autocomplete over `/api/search`. Used by every form that can be opened without a client. */
export function ClientPicker({
  onPick,
  label = 'Cliente',
}: {
  onPick: (client: SearchClient) => void;
  label?: string;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(text);
  const { data, isFetching } = useClientSearch(query);
  const results = text.trim() === '' ? [] : (data?.clients ?? []);
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    setActive(0);
  }, [query]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="label-caps">
        {label}
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
        autoComplete="off"
        data-autofocus
        value={text}
        placeholder="Buscar por nombre, dirección o teléfono"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            onPick(results[active]);
          }
        }}
        className="block w-full min-h-11 bg-paper text-ink text-base border border-ink rounded-sm px-3 placeholder:text-muted/70"
      />
      <ul id={listId} role="listbox" aria-label="Resultados" className="border-t border-rule">
        {results.map((client, index) => (
          <li
            key={client.id}
            id={`${listId}-${client.id}`}
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => onPick(client)}
            className={`flex min-h-11 cursor-pointer flex-col justify-center border-b border-rule px-2 py-1 ${
              index === active ? 'bg-paper-2' : ''
            }`}
          >
            <span className="text-sm font-semibold">{client.name}</span>
            <span className="text-xs text-muted">
              {KIND_LABELS[client.kind] ?? client.kind}
              {client.address ? ` · ${client.address}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {text.trim() !== '' && !isFetching && results.length === 0 ? (
        <p className="text-xs text-muted">Sin resultados.</p>
      ) : null}
    </div>
  );
}

/** Selected-client header shown inside a form, with a way to change it. */
export function SelectedClient({ name, onChange }: { name: string; onChange?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-l-4 border-ink bg-paper-2 px-3 py-2">
      <div>
        <p className="label-caps">Cliente</p>
        <p className="text-base font-bold">{name}</p>
      </div>
      {onChange ? (
        <button type="button" onClick={onChange} className="min-h-11 text-xs font-semibold uppercase tracking-wider underline">
          Cambiar
        </button>
      ) : null}
    </div>
  );
}
