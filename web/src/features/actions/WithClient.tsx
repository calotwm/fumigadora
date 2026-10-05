import { useState, type ReactNode } from 'react';
import { Sheet } from '../../ui/Sheet';
import { ClientPicker } from '../clients/ClientPicker';

interface WithClientProps {
  /** Client already known (opened from a client page or list row). */
  presetClientId?: number;
  /** Title of the picker step (the form sheet has its own title). */
  title: string;
  onClose: () => void;
  children: (clientId: number, changeClient: (() => void) | undefined) => ReactNode;
}

/** First step of every client-bound action: pick the client unless one is already known. */
export function WithClient({ presetClientId, title, onClose, children }: WithClientProps) {
  const [pickedId, setPickedId] = useState<number | null>(null);
  const clientId = presetClientId ?? pickedId;
  if (clientId === null) {
    return (
      <Sheet title={title} onClose={onClose}>
        <ClientPicker onPick={(client) => setPickedId(client.id)} />
      </Sheet>
    );
  }
  return <>{children(clientId, presetClientId === undefined ? () => setPickedId(null) : undefined)}</>;
}
