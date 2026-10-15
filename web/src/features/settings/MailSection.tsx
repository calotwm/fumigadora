import { useState, type FormEvent } from 'react';
import { useEmailStatus, useSendTestEmail } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { Button } from '../../ui/Button';
import { ErrorNote, Loading, SectionHead } from '../../ui/display';
import { Input } from '../../ui/form';
import { useToast } from '../../ui/Toast';
import { EmailLogList } from '../mail/EmailLogList';
import { NoticeModeFields } from './NoticeModeFields';

/** Ajustes > Mails: provider status, route notice timing, test send and the sent-mail log. */
export function MailSection() {
  const status = useEmailStatus();
  const send = useSendTestEmail();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!to.trim()) return setError('Ingrese un email.');
    setError(null);
    send.mutate(to.trim(), {
      onSuccess: (mail) => {
        toast.success(mail.status === 'simulated' ? 'Mail de prueba simulado (queda en el registro)' : mail.status === 'sent' ? 'Mail de prueba enviado' : 'No se pudo enviar el mail de prueba');
        if (mail.status === 'failed') setError(mail.error ?? 'No se pudo enviar.');
      },
      onError: (e) => setError(errorMessage(e)),
    });
  }

  return (
    <section aria-label="Mails" className="lg:col-span-2">
      <SectionHead title="Mails" />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {status.isLoading ? (
            <Loading />
          ) : status.error || !status.data ? (
            <ErrorNote message={errorMessage(status.error)} onRetry={() => status.refetch()} />
          ) : status.data.mode === 'simulated' ? (
            <div className="border-l-4 border-yellow bg-paper-2 px-3 py-3 text-sm">
              <p className="font-bold">Envío simulado</p>
              <p className="mt-1 text-muted">
                Los mails se arman y quedan en el registro, pero no se envían. Para activar el envío real, configure en el servidor las variables{' '}
                <code className="font-semibold text-ink">RESEND_API_KEY</code> y <code className="font-semibold text-ink">MAIL_FROM</code> (y, si lo desea,{' '}
                <code className="font-semibold text-ink">MAIL_REPLY_TO</code>).
              </p>
            </div>
          ) : (
            <div className="border-l-4 border-ink bg-paper-2 px-3 py-3 text-sm">
              <p className="font-bold">Envío real activo</p>
              <p className="mt-1 text-muted">
                Remitente: <span className="font-semibold text-ink">{status.data.from}</span>
              </p>
            </div>
          )}

          <div>
            <h3 className="label-caps mb-2 !text-ink">Avisos del recorrido</h3>
            <NoticeModeFields />
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <h3 className="label-caps !text-ink">Mail de prueba</h3>
            <Input
              label="Enviar a"
              type="email"
              autoComplete="off"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              error={error}
              hint="Sirve para ver cómo llega un mail. En modo simulado solo queda en el registro."
            />
            <div>
              <Button type="submit" variant="outline" disabled={send.isPending}>
                {send.isPending ? 'Enviando…' : 'Enviar prueba'}
              </Button>
            </div>
          </form>
        </div>

        <div>
          <h3 className="label-caps mb-2 !text-ink">Registro de mails</h3>
          <EmailLogList />
        </div>
      </div>
    </section>
  );
}
