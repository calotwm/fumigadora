import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { monthLabelEs, monthOf, monthRange, noticeDueDate, today as todayIso } from '@fumigadora/shared';
import { useRoute, useRouteActions, useSettings, useUsers } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { FREQUENCY_LABELS, dayMonth, fullDate, longDate } from '../../lib/format';
import type { RouteItem, RouteView as RouteData } from '../../lib/types';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { DateInput, Input } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { AssigneeSelect } from '../employees/AssigneeSelect';
import { ClientPicker } from '../clients/ClientPicker';
import { NoticeModeFields } from '../settings/NoticeModeFields';

const CONTROL = 'block w-full min-h-11 md:min-h-9 bg-paper text-ink text-sm border border-ink rounded-sm px-2';

function noticeLabel(item: RouteItem): string {
  switch (item.notice.state) {
    case 'no_email':
      return 'Sin email';
    case 'pending':
      return 'Se avisará al aprobar';
    case 'scheduled':
      return item.notice.dueOn ? `Aviso programado para ${dayMonth(item.notice.dueOn)}` : 'Aviso programado';
    case 'sent':
      return 'Aviso enviado';
    case 'simulated':
      return 'Aviso simulado';
    case 'failed':
      return 'Falló el envío';
  }
}

/** "Recorrido del mes": zone-based proposal that the owner reviews, then approves to create visits and send notices. */
export function RouteView({ month }: { month: string }) {
  const today = todayIso();
  const route = useRoute(month);
  const actions = useRouteActions(month);
  const toast = useToast();
  const [confirm, setConfirm] = useState<'generate' | 'approve' | null>(null);
  const [adding, setAdding] = useState(false);
  const [skipped, setSkipped] = useState<RouteData['skipped']>([]);

  if (route.isLoading) return <Loading />;
  if (route.error || !route.data) return <ErrorNote message={errorMessage(route.error)} onRetry={() => route.refetch()} />;

  const data = route.data;
  const approved = data.plan?.status === 'approved';
  const isPast = month < monthOf(today);
  const hasItems = data.totals.visits > 0;

  function generate() {
    return actions.generate.mutateAsync().then((result) => {
      setSkipped(result.skipped ?? []);
      toast.success(result.totals.visits === 0 ? 'No hay servicios pendientes para planificar' : `Recorrido generado: ${result.totals.visits} visitas`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Resumen del recorrido" className="border-t-4 border-ink pt-3">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <p className="label-caps">Recorrido de {monthLabelEs(month)}</p>
            <p className="text-lg font-extrabold tracking-tight">
              {!data.plan ? 'Sin generar' : approved ? 'Aprobado' : 'Borrador para revisar'}
              {approved && data.plan?.approvedAt ? (
                <span className="text-sm font-medium text-muted"> · {fullDate(data.plan.approvedAt.slice(0, 10))}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!approved ? (
              <>
                {data.plan ? (
                  <Button variant="outline" icon={<Plus size={16} aria-hidden />} onClick={() => setAdding(true)}>
                    Agregar cliente
                  </Button>
                ) : null}
                <Button
                  variant={data.plan ? 'outline' : 'accent'}
                  disabled={isPast || actions.generate.isPending}
                  onClick={() => (hasItems ? setConfirm('generate') : generate().catch((e) => toast.error(errorMessage(e))))}
                >
                  {actions.generate.isPending ? 'Generando…' : data.plan ? 'Regenerar' : 'Generar recorrido'}
                </Button>
                {data.plan ? (
                  <Button variant="accent" disabled={!hasItems} onClick={() => setConfirm('approve')}>
                    Aprobar y avisar
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        {data.plan ? (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:flex">
            {(
              [
                ['Visitas', data.totals.visits],
                ['Clientes', data.totals.clients],
                ['Con email', data.totals.withEmail],
                ['Sin email', data.totals.withoutEmail],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex-1 sm:border-l sm:border-rule sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
                <p className="label-caps">{label}</p>
                <p className="num text-3xl font-extrabold leading-none">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {approved ? (
          <p className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <strong>{data.totals.noticesSent + data.totals.noticesSimulated}</strong> avisos {data.totals.noticesSent === 0 && data.totals.noticesSimulated > 0 ? 'simulados' : 'enviados'}
            </span>
            {data.totals.noticesScheduled > 0 ? (
              <span>
                <strong>{data.totals.noticesScheduled}</strong> programados
              </span>
            ) : null}
            {data.totals.noticesFailed > 0 ? (
              <span>
                <strong>{data.totals.noticesFailed}</strong> con error (se reintentan mañana)
              </span>
            ) : null}
          </p>
        ) : null}
      </section>

      {skipped && skipped.length > 0 ? (
        <p role="status" className="border-l-4 border-yellow bg-paper-2 px-3 py-2 text-sm">
          No se incluyeron {skipped.length} {skipped.length === 1 ? 'cliente' : 'clientes'} por no tener servicio habitual definido:{' '}
          {skipped.map((s) => s.name).join(', ')}.
        </p>
      ) : null}

      {!data.plan ? (
        <EmptyState
          title={
            isPast
              ? 'Ese mes ya pasó: no se puede generar un recorrido.'
              : 'El sistema arma el recorrido agrupando a los clientes por zona y frecuencia. Usted lo revisa y, al aprobarlo, se crean las visitas y se avisa a cada cliente.'
          }
        />
      ) : !hasItems ? (
        <EmptyState title="No hay servicios pendientes de planificar este mes. Puede agregar clientes manualmente." />
      ) : (
        data.zones.map((zone) => (
          <section key={zone.zone ?? '_'} aria-label={`Zona ${zone.zone ?? 'sin zona'}`}>
            <div className="flex items-baseline gap-3 border-t-4 border-ink pt-2">
              <h3 className="label-caps !text-ink">{zone.zone ?? 'Sin zona'}</h3>
              <span className="num text-sm text-muted">
                {zone.count} {zone.count === 1 ? 'visita' : 'visitas'}
              </span>
            </div>
            {zone.dates.map((day) => (
              <div key={day.date}>
                <p className="mt-3 text-sm font-bold">
                  {longDate(day.date)} <span className="num font-normal text-muted">· {day.items.length}</span>
                </p>
                <ul>
                  {day.items.map((item) => (
                    <RouteRow key={item.id} item={item} month={month} editable={!approved} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}

      {confirm === 'generate' ? (
        <Confirm title="Regenerar recorrido" confirmLabel="Regenerar" onClose={() => setConfirm(null)} onConfirm={generate}>
          <p>Se descartará el borrador actual, con sus cambios manuales, y se armará uno nuevo.</p>
        </Confirm>
      ) : null}
      {confirm === 'approve' ? (
        <Confirm
          title="Aprobar y avisar"
          confirmLabel="Aprobar y avisar"
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            actions.approve.mutateAsync().then((result) => {
              const n = result.notices;
              toast.success(
                n && n.sent + n.simulated + n.failed > 0
                  ? `Recorrido aprobado: ${n.sent + n.simulated} avisos ${n.sent === 0 ? 'simulados' : 'enviados'}${n.failed ? `, ${n.failed} con error` : ''}`
                  : 'Recorrido aprobado',
              );
            })
          }
        >
          <ApproveSummary data={data} today={today} />
        </Confirm>
      ) : null}
      {adding ? <AddItemSheet month={month} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function ApproveSummary({ data, today }: { data: RouteData; today: string }) {
  const settings = useSettings();
  const mode = settings.data?.noticeMode ?? data.noticeMode;
  const daysBefore = settings.data?.noticeDaysBefore ?? data.noticeDaysBefore;
  const withEmail = data.zones.flatMap((z) => z.dates.flatMap((d) => d.items)).filter((i) => i.hasEmail);
  const now = withEmail.filter((i) => noticeDueDate(mode, i.date, today, daysBefore) <= today).length;
  const later = withEmail.length - now;
  return (
    <>
      <p>
        Se crearán <strong>{data.totals.visits}</strong> visitas programadas.
      </p>
      <p>
        {withEmail.length === 0 ? (
          'Ningún cliente tiene email: no se enviará ningún aviso.'
        ) : (
          <>
            Se enviarán <strong>{now}</strong> {now === 1 ? 'mail' : 'mails'} ahora
            {later > 0 ? (
              <>
                {' '}
                y se programarán <strong>{later}</strong> para {daysBefore} días antes de cada visita
              </>
            ) : null}
            .
          </>
        )}{' '}
        {data.totals.withoutEmail > 0 ? `${data.totals.withoutEmail} ${data.totals.withoutEmail === 1 ? 'cliente no tiene' : 'clientes no tienen'} email.` : ''}
      </p>
      <NoticeModeFields />
    </>
  );
}

function RouteRow({ item, month, editable }: { item: RouteItem; month: string; editable: boolean }) {
  const actions = useRouteActions(month);
  const toast = useToast();
  const { from, to } = monthRange(month);

  function patch(body: Parameters<typeof actions.patch.mutate>[0]['body']) {
    actions.patch.mutate({ id: item.id, body }, { onError: (e) => toast.error(errorMessage(e)) });
  }

  return (
    <li
      className={`grid gap-x-3 gap-y-2 border-b border-rule border-l-4 py-3 pl-2 md:items-center ${
        item.hasEmail ? 'border-l-transparent' : 'border-l-yellow'
      } ${editable ? 'md:grid-cols-[minmax(0,1.5fr)_150px_110px_190px_auto]' : 'md:grid-cols-[minmax(0,1.5fr)_110px_minmax(0,1fr)_minmax(0,1fr)]'}`}
    >
      <div className="min-w-0">
        <Link to={`/clientes/${item.clientId}`} className="block truncate text-base font-bold hover:underline">
          {item.clientName}
        </Link>
        <p className="truncate text-sm text-muted">
          {item.serviceTypeName} · {FREQUENCY_LABELS[item.frequency]}
        </p>
        {editable ? (
          <p className="truncate text-xs text-muted">{item.hasEmail ? item.email : 'Sin email: no recibirá aviso'}</p>
        ) : null}
      </div>
      {editable ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:contents">
            <input
              type="date"
              aria-label={`Fecha de ${item.clientName}`}
              className={CONTROL}
              value={item.date}
              min={from}
              max={to}
              onChange={(e) => e.target.value && e.target.value !== item.date && patch({ date: e.target.value })}
            />
            <input
              type="time"
              aria-label={`Hora de ${item.clientName}`}
              className={CONTROL}
              defaultValue={item.time ?? ''}
              key={`${item.id}-${item.time ?? ''}`}
              onBlur={(e) => e.target.value !== (item.time ?? '') && patch({ time: e.target.value || null })}
            />
          </div>
          <select
            aria-label={`Asignado a, ${item.clientName}`}
            className={CONTROL}
            value={item.assignedUserId ?? ''}
            onChange={(e) => patch({ assignedUserId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <AssigneeOptions current={item.assignedUserId} currentName={item.assigneeName} />
          </select>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Quitar a ${item.clientName} del recorrido`}
            disabled={actions.remove.isPending}
            onClick={() => actions.remove.mutate(item.id, { onError: (e) => toast.error(errorMessage(e)) })}
          >
            Quitar
          </Button>
        </>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm md:contents">
          <p className="num">{item.time ?? 'Sin hora'}</p>
          <p className="truncate">{item.assigneeName ?? 'Sin asignar'}</p>
          <p className={item.notice.state === 'no_email' ? 'text-muted' : 'font-semibold'}>{noticeLabel(item)}</p>
        </div>
      )}
      {editable && item.hasEmail ? (
        <p className="text-xs text-muted md:col-span-5">{noticeLabel(item)}</p>
      ) : null}
    </li>
  );
}

function AssigneeOptions({ current, currentName }: { current: number | null; currentName: string | null }) {
  const users = useUsers();
  const list = (users.data ?? []).filter((u) => u.active && u.assignable);
  return (
    <>
      <option value="">Sin asignar</option>
      {current !== null && !list.some((u) => u.id === current) ? <option value={current}>{currentName}</option> : null}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </>
  );
}

function AddItemSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const formId = useId();
  const toast = useToast();
  const actions = useRouteActions(month);
  const { from, to } = monthRange(month);
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [date, setDate] = useState(from);
  const [time, setTime] = useState('');
  const [assignee, setAssignee] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) return setError('Elija un cliente.');
    setError(null);
    actions.add.mutate(
      { clientId: client.id, date, time: time || undefined, assignedUserId: assignee === '' ? undefined : assignee },
      {
        onSuccess: () => {
          toast.success(`${client.name} agregado al recorrido`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Sheet
      title="Agregar cliente al recorrido"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="accent" disabled={actions.add.isPending} className="flex-[2]">
            Agregar
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5">
        {client ? (
          <div className="flex items-center justify-between gap-3 border-l-4 border-yellow pl-3">
            <p className="font-bold">{client.name}</p>
            <Button size="sm" variant="ghost" onClick={() => setClient(null)}>
              Cambiar
            </Button>
          </div>
        ) : (
          <ClientPicker onPick={(c) => setClient({ id: c.id, name: c.name })} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <DateInput label="Fecha" value={date} min={from} max={to} required onChange={(e) => setDate(e.target.value)} />
          <Input label="Hora (opcional)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <AssigneeSelect value={assignee} onChange={setAssignee} />
        {error ? (
          <p role="alert" className="text-xs text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
