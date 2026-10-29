import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronLeft, ChevronRight, LogOut, MapPin, MessageCircle, Phone } from 'lucide-react';
import { addDays, today as todayIso } from '@fumigadora/shared';
import { useLogout, useCurrentUser } from '../auth/auth';
import { useMyVisits } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { longDate, money } from '../../lib/format';
import { mapsLink, visitReminderText, whatsappLink } from '../../lib/whatsapp';
import type { MyVisit } from '../../lib/types';
import { AnchorButton, Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { NotificationBell } from '../notifications/NotificationBell';
import { DoneSheet } from './DoneSheet';
import plagamixWhite from '../../assets/plagamix-white.png';

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  if (date === addDays(today, -1)) return 'Ayer';
  return longDate(date);
}

/** Mobile-first screen for field employees: today's own services, mark done and cash collected. */
export function EmployeeApp() {
  const user = useCurrentUser();
  const logout = useLogout();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [marking, setMarking] = useState<MyVisit | null>(null);
  const { data, error, isLoading, refetch } = useMyVisits(date);

  const visits = data?.visits ?? [];
  const done = visits.filter((v) => v.status === 'done').length;
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
        {data ? (
          <p className="mt-3 text-sm text-muted num">
            {visits.length === 0
              ? 'Sin servicios asignados'
              : `${visits.length} ${visits.length === 1 ? 'servicio' : 'servicios'} · ${done} ${done === 1 ? 'hecho' : 'hechos'}`}
          </p>
        ) : null}
      </div>

      <main className="flex-1 px-4 pb-32 pt-2">
        {isLoading ? (
          <Loading />
        ) : error || !data ? (
          <ErrorNote message={errorMessage(error)} onRetry={() => refetch()} />
        ) : visits.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No tenés servicios asignados para este día." />
          </div>
        ) : (
          <ul>
            {visits.map((visit) => (
              <VisitItem key={visit.id} visit={visit} onMark={() => setMarking(visit)} />
            ))}
          </ul>
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
    </div>
  );
}

function VisitItem({ visit, onMark }: { visit: MyVisit; onMark: () => void }) {
  const isDone = visit.status === 'done';
  const wa = whatsappLink(visit.clientPhone, visitReminderText(visit.clientName, visit.serviceTypeName, longDate(visit.date).toLowerCase(), visit.time));
  const tel = visit.clientPhone ? `tel:${visit.clientPhone.replace(/[^\d+]/g, '')}` : null;

  return (
    <li className={`border-b border-rule py-4 ${isDone ? 'bg-paper-2/60' : ''}`}>
      <div className="grid grid-cols-[60px_1fr] gap-x-3">
        <p className="num text-xl font-extrabold leading-6">{visit.time ?? '—'}</p>
        <div className="min-w-0">
          <p className="text-lg font-extrabold leading-6">{visit.clientName}</p>
          <p className="text-sm text-muted">
            {visit.serviceTypeName}
            {visit.priceCents ? <span className="num"> · {money(visit.priceCents)}</span> : null}
          </p>
          {visit.clientAddress ? (
            <a
              href={mapsLink(visit.clientAddress)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex min-h-8 items-start gap-1 text-sm font-semibold hover:underline"
            >
              <MapPin size={14} className="mt-1 shrink-0" aria-hidden /> {visit.clientAddress}
            </a>
          ) : null}
          {visit.notes ? <p className="mt-1 text-sm">{visit.notes}</p> : null}
          {visit.clientBalanceCents > 0 && !isDone ? (
            <p className="mt-1 text-sm">
              Saldo del cliente: <span className="num font-bold text-red">{money(visit.clientBalanceCents)}</span>
            </p>
          ) : null}
        </div>
      </div>

      {isDone ? (
        <p className="mt-3 flex items-center gap-2 pl-[72px] text-sm font-bold">
          <span className="grid size-6 place-items-center bg-yellow text-ink">
            <Check size={16} aria-hidden />
          </span>
          Hecho
          {visit.cashCollectedCents > 0 ? <span className="num font-normal">· Efectivo {money(visit.cashCollectedCents)}</span> : null}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2 pl-[72px]">
          <Button variant="accent" className="min-h-14 w-full text-base" onClick={onMark} icon={<Check size={20} aria-hidden />}>
            Marcar hecho
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {tel ? (
              <AnchorButton variant="outline" href={tel} icon={<Phone size={14} aria-hidden />} aria-label={`Llamar a ${visit.clientName}`}>
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
                icon={<MessageCircle size={14} aria-hidden />}
                aria-label={`Escribir por WhatsApp a ${visit.clientName}`}
              >
                WhatsApp
              </AnchorButton>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}
