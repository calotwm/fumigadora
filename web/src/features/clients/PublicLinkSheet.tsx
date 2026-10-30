import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { usePublicLink, useRegeneratePublicLink } from '../../lib/queries';
import { AnchorButton, Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { ErrorNote, Loading } from '../../ui/display';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';

/** Public link of a client (the one the QR placard opens): copy it or replace it. */
export function PublicLinkSheet({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const link = usePublicLink(clientId);
  const regenerate = useRegeneratePublicLink();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado');
    } catch {
      toast.error('No se pudo copiar. Seleccioná el link y copialo a mano.');
    }
  }

  return (
    <Sheet title="Link público" onClose={onClose}>
      {link.isLoading ? (
        <Loading />
      ) : link.error || !link.data ? (
        <ErrorNote message={errorMessage(link.error)} onRetry={() => link.refetch()} />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">
            Cualquiera que tenga este link ve la próxima visita y la vigencia de la oblea. No muestra deuda, importes ni datos de contacto del cliente.
          </p>
          <input
            readOnly
            aria-label="Link público"
            value={link.data.url}
            onFocus={(e) => e.currentTarget.select()}
            className="block min-h-11 w-full rounded-sm border border-ink bg-paper-2 px-3 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button icon={<Copy size={16} aria-hidden />} onClick={() => copy(link.data.url)}>
              Copiar
            </Button>
            <AnchorButton variant="outline" href={link.data.url} target="_blank" rel="noreferrer" icon={<ExternalLink size={16} aria-hidden />}>
              Abrir
            </AnchorButton>
          </div>
          <div className="border-t border-rule pt-4">
            <p className="text-muted">Si el código se filtró o querés reemplazar el cartel, generá uno nuevo. El anterior deja de funcionar al instante.</p>
            <Button variant="outline" className="mt-3" disabled={regenerate.isPending} onClick={() => setConfirming(true)}>
              Generar link nuevo
            </Button>
          </div>
        </div>
      )}
      {confirming ? (
        <Confirm
          title="Generar link nuevo"
          confirmLabel="Generar"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await regenerate.mutateAsync(clientId);
            toast.success('Link nuevo generado. Reimprimí el cartel.');
            setConfirming(false);
          }}
        >
          <p>El link actual y el QR impreso van a dejar de funcionar. ¿Continuar?</p>
        </Confirm>
      ) : null}
    </Sheet>
  );
}
