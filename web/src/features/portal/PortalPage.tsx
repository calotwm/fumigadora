import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { ApiError, api, errorMessage } from '../../lib/api';
import { METHOD_LABELS, daysLeftLabel, fullDate, longDate, money, overdueLabel } from '../../lib/format';
import type {
  PortalCertificate,
  PortalClient,
  PortalInvoice,
  PortalPayment,
  PortalSummary,
  PortalVisit,
} from '../../lib/types';
import { AnchorButton, Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading, SectionHead, Stat, Tag } from '../../ui/display';
import { Input } from '../../ui/form';
import plagamixBlack from '../../assets/plagamix-black.png';

const ME_KEY = ['portal', 'me'] as const;

/** `/portal`: the client's login when there is no client session, their account otherwise. */
export function PortalPage() {
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<{ client: PortalClient }>('/portal/me'),
    retry: false,
    staleTime: Infinity,
  });
  const signedOut = me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);
  return (
    <PortalFrame client={me.data?.client ?? null}>
      {me.isLoading ? (
        <Loading />
      ) : signedOut ? (
        <PortalLogin />
      ) : me.error || !me.data ? (
        <ErrorNote message={errorMessage(me.error)} onRetry={() => me.refetch()} />
      ) : (
        <PortalAccount />
      )}
    </PortalFrame>
  );
}

/** Yellow brand header (with a sign-out button once signed in) around the portal screens. */
export function PortalFrame({ client, children }: { client: PortalClient | null; children: ReactNode }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST', body: {} }),
    onSettled: () => {
      queryClient.removeQueries({ queryKey: ['portal'] });
      queryClient.setQueryData(['auth'], false);
    },
  });
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-yellow px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <img src={plagamixBlack} alt="Plagamix" width={374} height={100} className="h-auto w-36" />
          {client ? (
            <Button size="sm" variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
              Salir
            </Button>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

function PortalLogin() {
  const [email, setEmail] = useState('');
  const request = useMutation({ mutationFn: (value: string) => api<{ message: string }>('/portal/login', { body: { email: value } }) });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) request.mutate(email.trim());
  }

  if (request.isSuccess) {
    return (
      <div className="border-t-4 border-ink pt-4">
        <p className="label-caps">Revisá tu correo</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Te enviamos un enlace</h1>
        <p className="mt-3 text-sm text-muted">{request.data.message}</p>
        <p className="mt-2 text-sm text-muted">El enlace sirve una sola vez y vence en 30 minutos.</p>
        <Button variant="outline" className="mt-6" onClick={() => request.reset()}>
          Usar otro email
        </Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-sm border-t-4 border-ink pt-4">
      <p className="label-caps">Portal de clientes</p>
      <h1 className="mb-2 mt-1 text-4xl font-extrabold tracking-tight">Ingresar</h1>
      <p className="mb-4 text-sm text-muted">
        Escribí el email que tenemos registrado y te mandamos un enlace para ver tus visitas, facturas, saldo y obleas. No hace falta contraseña.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={request.error ? errorMessage(request.error) : null}
        />
        <Button type="submit" variant="accent" disabled={request.isPending || !email.trim()}>
          {request.isPending ? 'Enviando…' : 'Enviarme el enlace'}
        </Button>
      </form>
    </div>
  );
}

function usePortal<T>(key: string, path: string) {
  return useQuery({ queryKey: ['portal', key], queryFn: () => api<T>(`/portal/${path}`) });
}

function PortalAccount() {
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => api<{ client: PortalClient }>('/portal/me'), staleTime: Infinity });
  const summary = usePortal<PortalSummary>('summary', 'summary');
  const invoices = usePortal<PortalInvoice[]>('invoices', 'invoices');
  const payments = usePortal<PortalPayment[]>('payments', 'payments');
  const visits = usePortal<PortalVisit[]>('visits', 'visits');
  const certificates = usePortal<PortalCertificate[]>('certificates', 'certificates');

  return (
    <div className="flex flex-col gap-10">
      <div className="border-t-4 border-ink pt-3">
        <p className="label-caps">Tu cuenta</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-4xl">{me.data?.client.name}</h1>
      </div>

      <Section title="Resumen" query={summary}>
        {(s) => <Overview summary={s} />}
      </Section>
      <Section title="Facturas" query={invoices}>
        {(list) => <Invoices invoices={list} />}
      </Section>
      <Section title="Pagos" query={payments}>
        {(list) => <Payments payments={list} />}
      </Section>
      <Section title="Obleas" query={certificates}>
        {(list) => <Certificates certificates={list} />}
      </Section>
      <Section title="Visitas" query={visits}>
        {(list) => <Visits visits={list} />}
      </Section>
    </div>
  );
}

function Section<T>({ title, query, children }: { title: string; query: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  return (
    <section aria-label={title}>
      <SectionHead title={title} />
      {query.isLoading ? <Loading /> : query.error || !query.data ? <ErrorNote message={errorMessage(query.error)} onRetry={() => query.refetch()} /> : children(query.data)}
    </section>
  );
}

function Overview({ summary }: { summary: PortalSummary }) {
  const owes = summary.balanceCents > 0;
  const overdue = summary.overdueCents > 0 && summary.daysOverdue > 0;
  const cert = summary.certificate;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <Stat
        label="Saldo"
        tone={owes ? 'red' : 'default'}
        value={summary.balanceCents < 0 ? `A favor ${money(-summary.balanceCents)}` : money(summary.balanceCents)}
        note={
          overdue ? (
            <span className="font-semibold text-red">
              {money(summary.overdueCents)} vencido · {overdueLabel(summary.daysOverdue)}
            </span>
          ) : (
            'Al día'
          )
        }
      />
      <div>
        <p className="label-caps">Próxima visita</p>
        {summary.nextVisits[0] ? (
          <>
            <p className="mt-2 text-2xl font-extrabold tracking-tight">{longDate(summary.nextVisits[0].date)}</p>
            <p className="mt-1 text-sm text-muted">
              {summary.nextVisits[0].serviceTypeName}
              {summary.nextVisits[0].time ? ` · ${summary.nextVisits[0].time} hs` : ''}
            </p>
            {summary.nextVisits.length > 1 ? (
              <ul className="mt-3 text-sm text-muted">
                {summary.nextVisits.slice(1).map((v) => (
                  <li key={v.id}>
                    {fullDate(v.date)} · {v.serviceTypeName}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm">Todavía no hay una visita programada.</p>
        )}
        {summary.lastVisitDate ? <p className="mt-3 text-xs text-muted">Última visita: {fullDate(summary.lastVisitDate)}</p> : null}
      </div>
      {cert ? (
        <div className="border border-ink p-4 md:col-span-2">
          <p className="label-caps">Oblea vigente</p>
          <p className={`mt-1 text-xl font-extrabold ${cert.valid ? '' : 'text-red'}`}>
            {cert.valid ? 'Vigente' : 'Vencida'} · hasta {fullDate(cert.expiresOn)}
          </p>
          <p className="text-sm text-muted">
            N.º {cert.number} · {daysLeftLabel(cert.daysLeft)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Invoices({ invoices }: { invoices: PortalInvoice[] }) {
  if (invoices.length === 0) return <EmptyState title="Todavía no hay facturas." />;
  return (
    <ul className="border-t border-ink">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="border-b border-rule">
          <details>
            <summary className="grid min-h-11 cursor-pointer grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span>
                <span className="font-bold">N.º {invoice.number}</span>
                <span className="block text-xs text-muted">
                  {fullDate(invoice.issuedOn)} · vence {fullDate(invoice.dueOn)}
                </span>
              </span>
              <span className="text-right">
                <span className="num block font-bold">{money(invoice.amountCents)}</span>
                <Tag status={invoice.status} />
              </span>
            </summary>
            <div className="pb-4 text-sm">
              <ul>
                {invoice.items.map((item, index) => (
                  <li key={index} className="flex justify-between gap-4 py-1">
                    <span>
                      {item.quantity > 1 ? `${item.quantity} × ` : ''}
                      {item.description}
                    </span>
                    <span className="num">{money(item.amountCents)}</span>
                  </li>
                ))}
              </ul>
              {invoice.balanceCents > 0 ? (
                <p className="mt-2 text-right font-semibold">
                  Saldo: <span className="num">{money(invoice.balanceCents)}</span>
                </p>
              ) : null}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Payments({ payments }: { payments: PortalPayment[] }) {
  if (payments.length === 0) return <EmptyState title="Todavía no hay pagos registrados." />;
  return (
    <ul className="border-t border-ink">
      {payments.map((payment) => (
        <li key={payment.id} className="flex items-start justify-between gap-4 border-b border-rule py-3 text-sm">
          <span>
            <span className="font-bold">{fullDate(payment.paidOn)}</span>
            <span className="block text-xs text-muted">
              {METHOD_LABELS[payment.method]}
              {payment.allocations.length > 0 ? ` · facturas ${payment.allocations.map((a) => a.invoiceNumber).join(', ')}` : ''}
            </span>
          </span>
          <span className="num font-bold">{money(payment.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function Certificates({ certificates }: { certificates: PortalCertificate[] }) {
  if (certificates.length === 0) return <EmptyState title="Todavía no hay obleas." />;
  return (
    <ul className="border-t border-ink">
      {certificates.map((cert) => (
        <li key={cert.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-rule py-3 text-sm">
          <span>
            <span className="font-bold">N.º {cert.number}</span>
            <span className="block text-xs text-muted">
              {cert.serviceTypeName ? `${cert.serviceTypeName} · ` : ''}
              emitida {fullDate(cert.issuedOn)} · {cert.valid ? 'vigente hasta' : 'venció el'} {fullDate(cert.expiresOn)}
            </span>
          </span>
          {cert.hasFile ? (
            <AnchorButton size="sm" variant="outline" href={`/api/portal/certificates/${cert.id}/file`} target="_blank" rel="noreferrer" icon={<Download size={14} aria-hidden />}>
              PDF
            </AnchorButton>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const VISIT_STATUS: Record<PortalVisit['status'], string> = { scheduled: 'Programada', done: 'Realizada', cancelled: 'Cancelada' };

function Visits({ visits }: { visits: PortalVisit[] }) {
  const [all, setAll] = useState(false);
  if (visits.length === 0) return <EmptyState title="Todavía no hay visitas." />;
  const shown = all ? visits : visits.slice(0, 8);
  return (
    <>
      <ul className="border-t border-ink">
        {shown.map((visit) => (
          <li key={visit.id} className="flex items-start justify-between gap-4 border-b border-rule py-3 text-sm">
            <span>
              <span className="font-bold">{fullDate(visit.date)}</span>
              <span className="block text-xs text-muted">
                {visit.serviceTypeName}
                {visit.time ? ` · ${visit.time} hs` : ''}
              </span>
            </span>
            <span className="label-caps">{VISIT_STATUS[visit.status]}</span>
          </li>
        ))}
      </ul>
      {visits.length > shown.length ? (
        <Button size="sm" variant="ghost" className="mt-3" onClick={() => setAll(true)}>
          Ver las {visits.length} visitas
        </Button>
      ) : null}
    </>
  );
}
