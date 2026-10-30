import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useReminderPreview, useSaveSettings, useSendReminders, useSettings } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate, money, overdueLabel } from '../../lib/format';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { EmptyState, ErrorNote, Loading, SectionHead } from '../../ui/display';
import { Checkbox, Input } from '../../ui/form';
import { useToast } from '../../ui/Toast';

/** Ajustes > Recordatorios de deuda: switch, interval, threshold, who would get one today, and a manual send. */
export function RemindersSection() {
  const settings = useSettings();
  const preview = useReminderPreview();
  const save = useSaveSettings();
  const sendNow = useSendReminders();
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [every, setEvery] = useState('15');
  const [min, setMin] = useState('10');
  const [ipcWarning, setIpcWarning] = useState(false);
  const [grace, setGrace] = useState('10');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.debtRemindersEnabled);
    setEvery(String(settings.data.debtReminderEveryDays));
    setMin(String(settings.data.debtReminderMinDaysOverdue));
    setIpcWarning(settings.data.ipcWarningEnabled);
    setGrace(String(settings.data.ipcWarningGraceDays));
  }, [settings.data]);

  if (settings.isLoading) return <Loading />;
  if (settings.error || !settings.data) return <ErrorNote message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />;

  const dirty =
    enabled !== settings.data.debtRemindersEnabled ||
    Number(every) !== settings.data.debtReminderEveryDays ||
    Number(min) !== settings.data.debtReminderMinDaysOverdue ||
    ipcWarning !== settings.data.ipcWarningEnabled ||
    Number(grace) !== settings.data.ipcWarningGraceDays;

  function submit(event: FormEvent) {
    event.preventDefault();
    const everyDays = Number(every);
    const minDays = Number(min);
    if (!Number.isInteger(everyDays) || everyDays < 1) return setError('Ingrese cada cuántos días se repite el recordatorio (mínimo 1).');
    if (!Number.isInteger(minDays) || minDays < 0) return setError('Ingrese desde cuántos días de atraso se avisa (0 o más).');
    const graceDays = Number(grace);
    if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 90) return setError('El plazo para pagar antes del interés debe ser de 1 a 90 días.');
    setError(null);
    save.mutate(
      {
        debtRemindersEnabled: enabled,
        debtReminderEveryDays: everyDays,
        debtReminderMinDaysOverdue: minDays,
        ipcWarningEnabled: ipcWarning,
        ipcWarningGraceDays: graceDays,
      },
      {
        onSuccess: () => toast.success('Recordatorios guardados'),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  const recipients = preview.data?.recipients ?? [];
  const skipped = preview.data?.skipped;

  return (
    <section aria-label="Recordatorios de deuda" className="lg:col-span-2">
      <SectionHead title="Recordatorios de deuda" />
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Checkbox
            label="Enviar recordatorios automáticos"
            hint="Todos los días, después de las 9:00, a los clientes con facturas vencidas y email."
            checked={enabled}
            onChange={setEnabled}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Repetir cada (días)" type="number" min={1} inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
            <Input
              label="Desde (días de atraso)"
              type="number"
              min={0}
              inputMode="numeric"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              hint="Se cuenta desde la factura vencida más antigua."
            />
          </div>
          <Checkbox
            label="Advertir interés por IPC"
            hint="El recordatorio avisa que, si no paga dentro del plazo, empezará a correr un interés según el IPC. Solo es un aviso: no cambia la deuda."
            checked={ipcWarning}
            onChange={setIpcWarning}
          />
          {ipcWarning ? (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Plazo para pagar (días)"
                type="number"
                min={1}
                max={90}
                inputMode="numeric"
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                hint="Desde el día en que sale el recordatorio."
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="label-caps !text-ink">Recibirían un recordatorio hoy</h3>
            <Button size="sm" variant="accent" disabled={recipients.length === 0} onClick={() => setConfirming(true)}>
              Enviar ahora{recipients.length > 0 ? ` (${recipients.length})` : ''}
            </Button>
          </div>
          {preview.isLoading ? (
            <Loading />
          ) : preview.error || !preview.data ? (
            <ErrorNote message={errorMessage(preview.error)} onRetry={() => preview.refetch()} />
          ) : recipients.length === 0 ? (
            <EmptyState title="Ningún cliente cumple las condiciones hoy." />
          ) : (
            <ul className="border-t border-ink">
              {recipients.map((r) => (
                <li key={r.clientId} className="flex items-center justify-between gap-3 border-b border-rule py-3">
                  <div className="min-w-0">
                    <Link to={`/clientes/${r.clientId}`} className="block truncate text-sm font-bold hover:underline">
                      {r.name}
                    </Link>
                    <p className="truncate text-xs text-muted">
                      {r.email}
                      {r.lastReminderOn ? ` · último aviso ${fullDate(r.lastReminderOn)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm font-bold text-red">{money(r.overdueCents)}</p>
                    <p className="text-xs text-red">{overdueLabel(r.daysOverdue)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {skipped && (skipped.no_email > 0 || skipped.too_recent > 0 || skipped.not_late_enough > 0) ? (
            <p className="num mt-2 text-xs text-muted">
              No recibirían: {skipped.no_email} sin email · {skipped.not_late_enough} con poco atraso · {skipped.too_recent} avisados hace poco.
            </p>
          ) : null}
          {!settings.data.debtRemindersEnabled ? (
            <p className="mt-2 text-xs text-muted">Los recordatorios automáticos están desactivados: esta lista es solo informativa.</p>
          ) : null}
        </div>
      </div>

      {confirming ? (
        <Confirm
          title="Enviar recordatorios ahora"
          confirmLabel="Enviar"
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            sendNow.mutateAsync().then((result) => {
              const count = result.sent + result.simulated;
              toast.success(`${count} ${count === 1 ? 'recordatorio' : 'recordatorios'} ${result.sent === 0 ? 'simulados' : 'enviados'}${result.failed ? `, ${result.failed} con error` : ''}`);
            })
          }
        >
          <p>
            Se enviará un mail con las facturas vencidas a <strong>{recipients.length}</strong> {recipients.length === 1 ? 'cliente' : 'clientes'}.
          </p>
          <p className="text-muted">No se repetirá a los mismos clientes hasta que pasen {every} días.</p>
        </Confirm>
      ) : null}
    </section>
  );
}
