import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Fuel, LogOut, MapPin, MessageCircle, Navigation, Phone } from 'lucide-react';
import { addDays, directionsLinks, today as todayIso } from '@fumigadora/shared';
import { useLogout, useCurrentUser } from '../auth/auth';
import { useMyVisits } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { longDate, money } from '../../lib/format';
import { mapsLink, visitReminderText, whatsappLink } from '../../lib/whatsapp';
import type { MyVisit } from '../../lib/types';
import { AnchorButton, Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, ProgressBar } from '../../ui/display';
import { NotificationBell } from '../notifications/NotificationBell';
import { ClientCancelledSheet } from './ClientCancelledSheet';
import { DoneSheet } from './DoneSheet';
import { FuelSheet } from './FuelSheet';
import { MyStationsSheet } from './MyStationsSheet';
import plagamixWhite from '../../assets/plagamix-white.png';

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  if (date === addDays(today, -1)) return 'Ayer';
  return longDate(date);
}

/**
 * Mobile-first screen for field employees: the day's route in driving order, the next stop highlighted, one big
 * "Marcar hecho" per visit and the rest of the actions one thumb away.
 */
export function EmployeeApp() {
  const user = useCurrentUser();
  const logout = useLogout();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [marking, setMarking] = useState<MyVisit | null>(null);
  const [cancelling, setCancelling] = useState<MyVisit | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [fueling, setFueling] = useState(false);
  const [stationsOf, setStationsOf] = useState<MyVisit | null>(null);
  const { data, error, isLoading, refetch } = useMyVisits(date);

  const visits = data?.visits ?? [];
  const pending = useMemo(() => visits.filter((v) => v.status === 'scheduled'), [visits]);
  const doneVisits = useMemo(() => visits.filter((v) => v.status === 'done'), [visits]);
  const routeLinks = useMemo(
    () =>
      directionsLinks(
        pending.map((v) => ({ latitude: v.clientLatitude, longitude: v.clientLongitude, address: v.clientAddress })),
        data?.base ?? null,
      ),
    [pending, data?.base],
  );
  const iconButton = 'grid size-11 place-items-center hover:bg-paper/10';

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-paper md:border-x md:border-rule">
      <header className="on-ink sticky top-0 z-20 border-t-4 border-t-yellow bg-ink text-paper">
        <div className="flex h-14 items-center justify-between pl-4 pr-1">
          <img src={plagamixWhite} alt="Plagamix" width={374} height={100} className="h-6 w-auto" />
          <div className="flex items-center">
            <span className="mr-2 max-w-40 truncate text-sm font-semibold">{user?.name}</span>
            <NotificationBell
              buttonClassName={iconButton}
              panelClassName="fixed right-2 top-16 w-[min(22rem,calc(100vw-1rem))]"
            />
            {user?.role === 'admin' ? (
              <Link to="/" aria-label="Volver al panel" className={iconButton}>
                <ChevronLeft size={20} aria-hidden />
              </Link>
            ) : null}
            <button type="button" aria-label="Salir" onClick={() => logout.mutate()} className={iconButton}>
              <LogOut size={20} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <div className="border-b border-ink px-4 pb-3 pt-4">
        <p className="label-caps">{date === today ? longDate(date) : 'Servicios del día'}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">{dayLabel(date, today)}</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Día anterior"
              onClick={() => setDate(addDays(date, -1))}
              className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Día siguiente"
              onClick={() => setDate(addDays(date, 1))}
              className="grid size-11 place-items-center border border-ink hover:bg-paper-2"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(
            [
              ['Hoy', today],
              ['Mañana', addDays(today, 1)],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={date === value}
              onClick={() => setDate(value)}
              className={`min-h-11 border text-sm font-semibold uppercase tracking-[0.06em] ${
                date === value ? 'border-ink bg-yellow text-ink' : 'border-rule bg-paper text-muted hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {data && visits.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="num text-base font-bold">
              {doneVisits.length} de {visits.length} {visits.length === 1 ? 'hecha' : 'hechas'}
            </p>
            <ProgressBar value={doneVisits.length} max={visits.length} label={`${doneVisits.length} de ${visits.length} hechas`} />
          </div>
        ) : null}
        {routeLinks.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="label-caps">Abrir recorrido en Google Maps</p>
            <div className="grid grid-cols-2 gap-2">
              {routeLinks.map((link) => (
                <AnchorButton
                  key={link.label}
                  variant="outline"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  icon={<Navigation size={16} aria-hidden />}
                  className={routeLinks.length === 1 ? 'col-span-2' : ''}
                >
                  {link.label}
                </AnchorButton>
              ))}
            </div>
          </div>
        ) : null}
        <Button variant="outline" className="mt-3 w-full" onClick={() => setFueling(true)} icon={<Fuel size={16} aria-hidden />}>
          Cargar nafta
        </Button>
      </div>

      <main className="flex-1 px-4 pb-32 pt-4">
        {isLoading ? (
          <Loading />
        ) : error || !data ? (
          <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
        ) : visits.length === 0 ? (
          <EmptyState title="No tenés servicios asignados para este día." />
        ) : (
          <>
            {pending.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {pending.map((visit, index) => (
                  <PendingCard
                    key={visit.id}
                    visit={visit}
                    stop={index + 1}
                    isNext={index === 0}
                    onMark={() => setMarking(visit)}
                    onCancel={() => setCancelling(visit)}
                    onStations={() => setStationsOf(visit)}
                  />
                ))}
              </ul>
            ) : (
              <p className="border-l-4 border-yellow bg-paper-2 px-3 py-3 text-base font-bold">¡Terminaste los servicios del día!</p>
            )}
            {doneVisits.length > 0 ? (
              <section className="mt-6" aria-label="Servicios hechos">
                <button
                  type="button"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((open) => !open)}
                  className="flex min-h-12 w-full items-center justify-between border-y border-ink text-left text-sm font-bold uppercase tracking-[0.06em]"
                >
                  Hechas ({doneVisits.length})
                  <ChevronDown size={18} aria-hidden className={showDone ? 'rotate-180' : ''} />
                </button>
                {showDone ? (
                  <ul>
                    {doneVisits.map((visit) => (
                      <DoneRow key={visit.id} visit={visit} />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </main>

      <footer className="on-ink fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl border-t-4 border-t-yellow bg-ink pb-[env(safe-area-inset-bottom)] text-paper">
        <div className="flex items-baseline justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-paper/60">Efectivo a rendir</p>
            <p className="text-xs text-paper/60">
              {data && data.cashPending.count > 0
                ? `${data.cashPending.count} ${data.cashPending.count === 1 ? 'cobro' : 'cobros'} sin entregar`
                : 'Nada pendiente'}
            </p>
          </div>
          <p aria-label="Efectivo a rendir" className="num text-2xl font-extrabold text-yellow">
            {money(data?.cashPending.cents ?? 0)}
          </p>
        </div>
      </footer>

      {marking ? <DoneSheet visit={marking} onClose={() => setMarking(null)} /> : null}
      {stationsOf ? <MyStationsSheet visit={stationsOf} onClose={() => setStationsOf(null)} /> : null}
      {fueling ? <FuelSheet onClose={() => setFueling(false)} /> : null}
      {cancelling ? <ClientCancelledSheet visit={cancelling} onClose={() => setCancelling(null)} /> : null}
    </div>
  );
}

function PendingCard({
  visit,
  stop,
  isNext,
  onMark,
  onCancel,
  onStations,
}: {
  visit: MyVisit;
  stop: number;
  isNext: boolean;
  onMark: () => void;
  onCancel: () => void;
  onStations: () => void;
}) {
  const wa = whatsappLink(visit.clientPhone, visitReminderText(visit.clientName, visit.serviceTypeName, longDate(visit.date).toLowerCase(), visit.time));
  const tel = visit.clientPhone ? `tel:${visit.clientPhone.replace(/[^\d+]/g, '')}` : null;
  const map = visit.clientAddress ? mapsLink(visit.clientAddress) : null;
  const secondary = 'min-h-12 text-xs';

  return (
    <li className={`border-2 p-4 ${isNext ? 'border-ink bg-yellow/15 shadow-[4px_4px_0_0_var(--color-yellow)]' : 'border-rule bg-paper'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isNext ? <p className="label-caps !text-ink">Siguiente · parada {stop}</p> : <p className="label-caps">Parada {stop}</p>}
          <p className="mt-1 text-xl font-extrabold leading-6">{visit.clientName}</p>
          <p className="mt-1 text-sm text-muted">
            {visit.serviceTypeName}
            {visit.priceCents ? <span className="num"> · {money(visit.priceCents)}</span> : null}
          </p>
        </div>
        <p className="num shrink-0 text-2xl font-extrabold leading-6">{visit.time ?? '—'}</p>
      </div>
      {visit.clientAddress ? (
        <p className="mt-2 flex items-start gap-1 text-base font-semibold">
          <MapPin size={16} className="mt-1 shrink-0" aria-hidden /> {visit.clientAddress}
        </p>
      ) : null}
      {visit.notes ? <p className="mt-1 text-sm">{visit.notes}</p> : null}
      {visit.clientBalanceCents > 0 ? (
        <p className="mt-1 text-sm">
          Saldo del cliente: <span className="num font-bold text-red">{money(visit.clientBalanceCents)}</span>
        </p>
      ) : null}

      <Button variant="accent" className="mt-4 min-h-14 w-full text-base" onClick={onMark} icon={<Check size={20} aria-hidden />}>
        Marcar hecho
      </Button>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {tel ? (
          <AnchorButton variant="outline" href={tel} className={secondary} icon={<Phone size={14} aria-hidden />} aria-label={`Llamar a ${visit.clientName}`}>
            Llamar
          </AnchorButton>
        ) : (
          <span />
        )}
        {wa ? (
          <AnchorButton
            variant="outline"
            href={wa}
            target="_blank"
            rel="noreferrer"
            className={secondary}
            icon={<MessageCircle size={14} aria-hidden />}
            aria-label={`Escribir por WhatsApp a ${visit.clientName}`}
          >
            WhatsApp
          </AnchorButton>
        ) : (
          <span />
        )}
        {map ? (
          <AnchorButton
            variant="outline"
            href={map}
            target="_blank"
            rel="noreferrer"
            className={secondary}
            icon={<MapPin size={14} aria-hidden />}
            aria-label={`Abrir ${visit.clientName} en el mapa`}
          >
            Mapa
          </AnchorButton>
        ) : (
          <span />
        )}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Button variant="ghost" className="w-full" onClick={onStations}>
          Cebaderos
        </Button>
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          El cliente canceló
        </Button>
      </div>
    </li>
  );
}

function DoneRow({ visit }: { visit: MyVisit }) {
  return (
    <li className="flex items-center gap-3 border-b border-rule py-3">
      <span className="grid size-6 shrink-0 place-items-center bg-yellow text-ink">
        <Check size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-bold">{visit.clientName}</p>
        <p className="text-sm text-muted">
          {visit.serviceTypeName}
          {visit.paidCents > 0 ? (
            <span className="num">
              {' '}
              · Cobrado {money(visit.paidCents)}
              {visit.cashCollectedCents > 0 ? ` (efectivo ${money(visit.cashCollectedCents)})` : ''}
            </span>
          ) : null}
        </p>
      </div>
      <span className="num text-sm">{visit.time ?? ''}</span>
    </li>
  );
}
