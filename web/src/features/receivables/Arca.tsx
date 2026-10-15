import { ARCA_CBTE_LETTER, formatArcaNumber } from '@fumigadora/shared';
import { errorMessage } from '../../lib/api';
import { dayMonth } from '../../lib/format';
import { useArcaStatus, useEmitInvoice } from '../../lib/queries';
import type { Invoice } from '../../lib/types';
import { Button } from '../../ui/Button';
import { useToast } from '../../ui/Toast';

/** `Factura C 0003-00000123`. */
export function arcaDocument(i: Invoice): string | null {
  if (i.cbteType === null || i.ptoVta === null || i.cbteNumber === null) return null;
  return `Factura ${ARCA_CBTE_LETTER[i.cbteType] ?? ''} ${formatArcaNumber(i.ptoVta, i.cbteNumber)}`.replace('  ', ' ');
}

function firstProblem(i: Invoice): string | null {
  const d = i.arcaObservations;
  if (!d) return null;
  if (d.message) return d.message;
  return [...d.errors, ...d.observations].map((m) => `${m.code}: ${m.msg}`).join(' · ') || null;
}

/** ARCA state of an invoice: tag plus, when there is something to say, one detail line. */
export function ArcaState({ invoice }: { invoice: Invoice }) {
  if (invoice.voided) return <span className="text-muted">—</span>;
  const problem = firstProblem(invoice);
  switch (invoice.arcaStatus) {
    case 'authorized':
      return (
        <div className="min-w-0">
          <span className="label-caps !text-ink">Autorizada</span>
          <p className="num text-xs">{arcaDocument(invoice)}</p>
          <p className="num text-xs text-muted">
            CAE {invoice.cae}
            {invoice.caeDueOn ? ` · vence ${dayMonth(invoice.caeDueOn)}` : ''}
          </p>
        </div>
      );
    case 'rejected':
      return (
        <div className="min-w-0">
          <span className="label-caps !text-red">Rechazada</span>
          {problem ? <p className="text-xs text-red">{problem}</p> : null}
        </div>
      );
    case 'error':
      return (
        <div className="min-w-0">
          <span className="label-caps !text-red">Error</span>
          {problem ? <p className="text-xs text-muted">{problem}</p> : null}
        </div>
      );
    default:
      return <span className="label-caps">No enviada</span>;
  }
}

/** "Emitir en ARCA": only offered while the invoice is not authorized; disabled until ARCA is configured. */
export function EmitButton({ invoice }: { invoice: Invoice }) {
  const status = useArcaStatus();
  const emit = useEmitInvoice();
  const toast = useToast();
  if (invoice.voided || invoice.arcaStatus === 'authorized') return null;
  const configured = status.data?.configured === true;
  const retry = invoice.arcaStatus === 'rejected' || invoice.arcaStatus === 'error';
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!configured || emit.isPending}
      title={configured ? undefined : 'Pendiente de activación: falta configurar ARCA en Ajustes'}
      onClick={() =>
        emit.mutate(invoice.id, {
          onSuccess: (res) => {
            if (res.arcaStatus === 'authorized') toast.success(`${arcaDocument(res) ?? 'Factura'} autorizada · CAE ${res.cae}`);
            else toast.error(res.arcaStatus === 'rejected' ? 'ARCA rechazó la factura. Revisá las observaciones.' : 'No se pudo emitir en ARCA. Podés reintentar.');
          },
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    >
      {emit.isPending ? 'Emitiendo…' : retry ? 'Reintentar en ARCA' : 'Emitir en ARCA'}
    </Button>
  );
}
