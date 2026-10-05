import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Visit } from '../../lib/types';
import { ClientFormSheet } from '../clients/ClientFormSheet';
import { ExpenseSheet } from './ExpenseSheet';
import { InvoiceSheet } from './InvoiceSheet';
import { PaymentSheet } from './PaymentSheet';
import { CancelVisitSheet, CompleteVisitSheet, RescheduleVisitSheet } from '../agenda/VisitActionSheets';
import { VisitSheet } from './VisitSheets';

export type Action =
  | { type: 'payment'; clientId?: number; invoiceId?: number }
  | { type: 'invoice'; clientId?: number }
  | { type: 'visit'; clientId?: number; date?: string }
  | { type: 'expense' }
  | { type: 'client' }
  | { type: 'clientEdit'; clientId: number }
  | { type: 'completeVisit'; visit: Visit }
  | { type: 'rescheduleVisit'; visit: Visit }
  | { type: 'cancelVisit'; visit: Visit };

interface ActionsApi {
  open: (action: Action) => void;
  quickMenuOpen: boolean;
  setQuickMenuOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const ActionsContext = createContext<ActionsApi | null>(null);

export function useActions(): ActionsApi {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used within ActionsProvider');
  return ctx;
}

export const QUICK_ACTIONS: { id: string; label: string; action: Action }[] = [
  { id: 'payment', label: 'Registrar pago', action: { type: 'payment' } },
  { id: 'invoice', label: 'Nueva factura', action: { type: 'invoice' } },
  { id: 'visit', label: 'Nueva visita', action: { type: 'visit' } },
  { id: 'expense', label: 'Registrar gasto', action: { type: 'expense' } },
  { id: 'client', label: 'Nuevo cliente', action: { type: 'client' } },
];

/** Hosts the global action sheets so any screen (and the command palette) can open them. */
export function ActionsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Action | null>(null);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const close = useCallback(() => setActive(null), []);
  const open = useCallback((action: Action) => {
    setQuickMenuOpen(false);
    setPaletteOpen(false);
    setActive(action);
  }, []);

  const api = useMemo(
    () => ({ open, quickMenuOpen, setQuickMenuOpen, paletteOpen, setPaletteOpen }),
    [open, quickMenuOpen, paletteOpen],
  );

  return (
    <ActionsContext.Provider value={api}>
      {children}
      {active?.type === 'payment' ? (
        <PaymentSheet clientId={active.clientId} invoiceId={active.invoiceId} onClose={close} />
      ) : null}
      {active?.type === 'invoice' ? <InvoiceSheet clientId={active.clientId} onClose={close} /> : null}
      {active?.type === 'visit' ? <VisitSheet clientId={active.clientId} date={active.date} onClose={close} /> : null}
      {active?.type === 'expense' ? <ExpenseSheet onClose={close} /> : null}
      {active?.type === 'client' ? (
        <ClientFormSheet onClose={close} onSaved={(id) => navigate(`/clientes/${id}`)} />
      ) : null}
      {active?.type === 'clientEdit' ? <ClientFormSheet clientId={active.clientId} onClose={close} /> : null}
      {active?.type === 'completeVisit' ? <CompleteVisitSheet visit={active.visit} onClose={close} /> : null}
      {active?.type === 'rescheduleVisit' ? <RescheduleVisitSheet visit={active.visit} onClose={close} /> : null}
      {active?.type === 'cancelVisit' ? <CancelVisitSheet visit={active.visit} onClose={close} /> : null}
    </ActionsContext.Provider>
  );
}
