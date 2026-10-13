import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useActions, QUICK_ACTIONS } from '../features/actions/ActionsProvider';
import { useClientSearch } from '../lib/queries';
import { KIND_LABELS } from '../lib/format';
import { NAV_ITEMS } from './nav';

interface Item {
  key: string;
  group: string;
  label: string;
  detail?: string;
  run: () => void;
}

/** Ctrl/Cmd+K: search clients, jump to a section or start a quick action. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { open } = useActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const search = useClientSearch(debounced);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text), 180);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    setActive(0);
  }, [text, search.data]);

  const items = useMemo<Item[]>(() => {
    const q = text.trim().toLowerCase();
    const matches = (label: string) => q === '' || label.toLowerCase().includes(q);
    const result: Item[] = [];
    for (const quick of QUICK_ACTIONS) {
      if (matches(quick.label)) result.push({ key: `a-${quick.id}`, group: 'Acciones', label: quick.label, run: () => open(quick.action) });
    }
    if (q !== '') {
      for (const client of search.data?.clients ?? []) {
        result.push({
          key: `c-${client.id}`,
          group: 'Clientes',
          label: client.name,
          detail: [KIND_LABELS[client.kind], client.address].filter(Boolean).join(' · '),
          run: () => {
            onClose();
            navigate(`/clientes/${client.id}`);
          },
        });
      }
    }
    for (const nav of NAV_ITEMS) {
      if (q !== '' && matches(nav.label)) {
        result.push({
          key: `n-${nav.to}`,
          group: 'Ir a',
          label: nav.label,
          run: () => {
            onClose();
            navigate(nav.to);
          },
        });
      }
    }
    return result;
  }, [text, search.data, open, navigate, onClose]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[active]?.run();
    }
  }

  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center md:pt-24">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar y acciones rápidas"
        onKeyDown={onKeyDown}
        className="relative flex h-dvh w-full flex-col border-t-4 border-ink bg-paper md:h-auto md:max-h-[70dvh] md:max-w-xl"
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${items[active].key}` : undefined}
          aria-label="Buscar cliente o acción"
          placeholder="Buscar cliente o acción…"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-14 w-full border-b border-rule bg-paper px-4 text-base outline-none placeholder:text-muted/70 focus-visible:outline-offset-[-2px]"
        />
        <ul id={listId} role="listbox" className="flex-1 overflow-y-auto">
          {items.map((item, index) => {
            const header = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <li key={item.key} role="presentation">
                {header ? <p className="label-caps px-4 pb-1 pt-3">{item.group}</p> : null}
                <div
                  id={`${listId}-${item.key}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={item.run}
                  className={`flex min-h-11 cursor-pointer flex-col justify-center border-l-4 px-4 py-1 ${
                    index === active ? 'border-yellow bg-paper-2' : 'border-transparent'
                  }`}
                >
                  <span className="text-sm font-semibold">{item.label}</span>
                  {item.detail ? <span className="text-xs text-muted">{item.detail}</span> : null}
                </div>
              </li>
            );
          })}
          {items.length === 0 ? <li className="px-4 py-4 text-sm text-muted">Sin resultados.</li> : null}
        </ul>
        <p className="hidden border-t border-rule px-4 py-2 text-xs text-muted md:block">
          ↑↓ navegar · Enter seleccionar · Esc cerrar
        </p>
      </div>
    </div>,
    document.body,
  );
}
