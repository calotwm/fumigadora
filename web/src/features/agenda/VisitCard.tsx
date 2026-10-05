import { Link } from 'react-router';
import { MapPin, MessageCircle, Phone } from 'lucide-react';
import { Button, AnchorButton } from '../../ui/Button';
import { FREQUENCY_LABELS, dayMonth, longDate } from '../../lib/format';
import { mapsLink, visitReminderText, whatsappLink } from '../../lib/whatsapp';
import { useActions } from '../actions/ActionsProvider';
import type { Visit } from '../../lib/types';

/** One visit in route-sheet style: time, client, address, contact shortcuts and actions. */
export function VisitCard({ visit, showDate = false }: { visit: Visit; showDate?: boolean }) {
  const { open } = useActions();
  const scheduled = visit.status === 'scheduled';
  const wa = whatsappLink(
    visit.clientPhone,
    visitReminderText(visit.clientName, visit.serviceTypeName, longDate(visit.date).toLowerCase(), visit.time),
  );
  const link = 'inline-flex min-h-8 items-center gap-1 font-semibold hover:underline';

  return (
    <li className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-2 border-b border-rule py-4">
      <div className="num">
        <p className="text-xl font-extrabold leading-6">{visit.time ?? '—'}</p>
        {showDate ? <p className="text-xs text-muted">{dayMonth(visit.date)}</p> : null}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Link to={`/clientes/${visit.clientId}`} className="text-base font-bold hover:underline">
            {visit.clientName}
          </Link>
          {!scheduled ? <span className="label-caps !text-ink">Realizada</span> : null}
        </div>
        <p className="text-sm text-muted">
          {visit.serviceTypeName}
          {visit.frequency !== 'none' ? ` · ${FREQUENCY_LABELS[visit.frequency]}` : ''}
        </p>
        {visit.notes ? <p className="mt-1 text-sm">{visit.notes}</p> : null}
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm">
          {visit.clientAddress ? (
            <a href={mapsLink(visit.clientAddress)} target="_blank" rel="noreferrer" className={link}>
              <MapPin size={14} aria-hidden /> {visit.clientAddress}
            </a>
          ) : null}
          {visit.clientPhone ? (
            <a href={`tel:${visit.clientPhone.replace(/[^\d+]/g, '')}`} className={link}>
              <Phone size={14} aria-hidden /> {visit.clientPhone}
            </a>
          ) : null}
        </div>
        {scheduled ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => open({ type: 'completeVisit', visit })}>
              Completar
            </Button>
            {wa ? (
              <AnchorButton
                size="sm"
                variant="outline"
                href={wa}
                target="_blank"
                rel="noreferrer"
                icon={<MessageCircle size={14} aria-hidden />}
                aria-label={`Recordar visita por WhatsApp a ${visit.clientName}`}
              >
                WhatsApp
              </AnchorButton>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => open({ type: 'rescheduleVisit', visit })}>
              Reprogramar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => open({ type: 'cancelVisit', visit })}>
              Cancelar
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
