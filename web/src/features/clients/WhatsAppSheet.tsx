import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { today } from '@fumigadora/shared';
import { longDate } from '../../lib/format';
import { useSettings } from '../../lib/queries';
import { ipcInterestFrom, overdueDebtText, overdueInvoices, visitReminderText, whatsappLink } from '../../lib/whatsapp';
import { AnchorButton } from '../../ui/Button';
import { Chips, Textarea } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';
import type { ClientDetail, Statement } from '../../lib/types';

type Kind = 'debt' | 'visit' | 'blank';

/**
 * Picks a message for the client and opens WhatsApp (wa.me) on the operator's own phone with the client's number and
 * the text ready to send. Nothing is sent from the server.
 */
export function WhatsAppSheet({ client, statement, onClose }: { client: ClientDetail; statement: Statement | undefined; onClose: () => void }) {
  const settings = useSettings();
  const day = today();
  const debt = statement ? overdueInvoices(statement.invoices, day) : null;
  const nextVisit = client.summary.nextVisits[0] ?? null;

  const templates: Record<Kind, string | null> = {
    debt:
      debt && debt.invoices.length > 0
        ? overdueDebtText({ clientName: client.name, ...debt, interestFrom: ipcInterestFrom(settings.data, day) })
        : null,
    visit: nextVisit
      ? visitReminderText(client.name, nextVisit.serviceTypeName, longDate(nextVisit.date).toLowerCase(), nextVisit.time)
      : null,
    blank: '',
  };
  const available = (['debt', 'visit', 'blank'] as const).filter((k) => templates[k] !== null);
  const [kind, setKind] = useState<Kind>(available[0] ?? 'blank');
  const [text, setText] = useState(templates[kind] ?? '');
  // The debt text depends on the statement and settings, which may arrive after the sheet opened.
  const [edited, setEdited] = useState(false);
  const shown = edited ? text : (templates[kind] ?? '');

  function pick(next: Kind) {
    setKind(next);
    setText(templates[next] ?? '');
    setEdited(false);
  }

  const link = whatsappLink(client.phone, shown.trim() ? shown : undefined);
  const LABELS: Record<Kind, string> = { debt: 'Recordatorio de deuda', visit: 'Recordatorio de próxima visita', blank: 'Mensaje en blanco' };

  return (
    <Sheet
      title="Enviar WhatsApp"
      onClose={onClose}
      footer={
        link ? (
          <AnchorButton href={link} target="_blank" rel="noreferrer" icon={<MessageCircle size={16} aria-hidden />} onClick={onClose}>
            Abrir WhatsApp
          </AnchorButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          Se abre WhatsApp en este teléfono o computadora con el número del cliente ({client.phone}) y el mensaje listo. Revíselo y envíelo
          desde ahí.
        </p>
        <Chips label="Mensaje" value={kind} options={available.map((k) => ({ value: k, label: LABELS[k] }))} onChange={pick} />
        {templates.debt === null ? (
          <p className="text-xs text-muted">{statement ? 'El cliente no tiene facturas vencidas.' : 'Cargando la deuda del cliente…'}</p>
        ) : null}
        {templates.visit === null ? <p className="text-xs text-muted">El cliente no tiene una próxima visita agendada.</p> : null}
        <Textarea
          label="Texto"
          rows={10}
          value={shown}
          placeholder="Escriba el mensaje o déjelo vacío"
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
        />
      </div>
    </Sheet>
  );
}
