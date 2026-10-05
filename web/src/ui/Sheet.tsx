import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** `sheet`: right drawer on desktop, full-height bottom sheet on mobile. `modal`: centered dialog. */
  variant?: 'sheet' | 'modal';
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Accessible dialog: Escape closes, focus is trapped and restored, body scroll is locked. */
export function Sheet({ title, onClose, children, footer, variant = 'sheet' }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus],input,select,textarea');
    (first ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const position =
    variant === 'modal'
      ? 'items-end md:items-center justify-center'
      : 'items-stretch md:items-stretch justify-end';
  const panelClass =
    variant === 'modal'
      ? 'w-full md:max-w-md max-h-[90dvh] border-t-4 border-ink'
      : 'w-full h-dvh md:max-w-xl border-t-4 border-ink md:border-l md:border-l-ink';

  return createPortal(
    <div className={`fixed inset-0 z-50 flex ${position}`}>
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex flex-col bg-paper outline-none ${panelClass}`}
      >
        <header className="flex items-start justify-between gap-4 px-4 md:px-6 pt-4 pb-3 border-b border-rule">
          <h2 id={titleId} className="text-xl font-extrabold tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 grid size-11 place-items-center hover:bg-paper-2 rounded-sm"
          >
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">{children}</div>
        {footer ? (
          <footer className="px-4 md:px-6 py-3 border-t border-rule bg-paper-2 pb-[max(12px,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
