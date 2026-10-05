import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';
import { errorMessage } from '../lib/api';

interface ConfirmProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Runs the mutation; reject to show the error and keep the dialog open. */
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/** Small confirmation modal for destructive actions. Red confirm button, error shown inline. */
export function Confirm({ title, children, confirmLabel, onConfirm, onClose }: ConfirmProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={title} onClose={onClose} variant="modal">
      <div className="flex flex-col gap-4 text-sm">
        {children}
        {error ? (
          <p role="alert" className="text-red">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1" data-autofocus>
            Volver
          </Button>
          <Button
            variant="accent"
            className="flex-[2]"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(errorMessage(e));
                setPending(false);
              }
            }}
          >
            {pending ? 'Procesando…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
