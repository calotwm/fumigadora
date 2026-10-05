import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: Tone) => {
    const id = ++counter.current;
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), tone === 'error' ? 7000 : 4500);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push(m, 'ok'), error: (m) => push(m, 'error') }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 md:bottom-6 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto max-w-md w-full md:w-auto border-l-4 px-4 py-3 text-sm font-medium bg-ink text-paper ${
              item.tone === 'error' ? 'border-red' : 'border-paper'
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
