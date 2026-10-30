import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { MapPin, MessageCircle, Phone } from 'lucide-react';
import { useClient, useStatement, useUnarchiveClient } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { KIND_LABELS, money, overdueLabel } from '../../lib/format';
import { debtReminderText, mapsLink, whatsappLink } from '../../lib/whatsapp';
import { AnchorButton, Button, LinkButton } from '../../ui/Button';
import { ErrorNote, Loading, Stat, Tabs } from '../../ui/display';
import { useToast } from '../../ui/Toast';
import { useActions } from '../actions/ActionsProvider';
import type { ClientDetail, Statement } from '../../lib/types';
import { BUCKET_LABELS } from './balance';
import { EmailLogList } from '../mail/EmailLogList';
import { PublicLinkSheet } from './PublicLinkSheet';
import { AccountTab, CertificatesTab, DataTab, InvoicesTab, VisitsTab } from './ClientTabs';

const TABS = [
  { id: 'cuenta', label: 'Cuenta corriente' },
  { id: 'visitas', label: 'Visitas' },
  { id: 'facturas', label: 'Facturas' },
  { id: 'obleas', label: 'Obleas' },
  { id: 'mails', label: 'Mails' },
  { id: 'datos', label: 'Datos' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ClientPage() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const client = useClient(valid ? id : null);
  const statement = useStatement(valid ? id : null);

  if (!valid) return <ErrorNote message="El cliente no existe." />;
  if (client.isLoading) return <Loading />;
  if (client.error || !client.data) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNote message={errorMessage(client.error)} onRetry={() => client.refetch()} />
        <Link to="/clientes" className="text-sm font-semibold underline">
          Volver a clientes
        </Link>
      </div>
    );
  }
  return <ClientView client={client.data} statement={statement.data} statementError={statement.error} />;
}

function ClientView({
  client,
  statement,
  statementError,
}: {
  client: ClientDetail;
  statement: Statement | undefined;
  statementError: unknown;
}) {
  const { open } = useActions();
  const toast = useToast();
  const unarchive = useUnarchiveClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = TABS.find((t) => t.id === requested)?.id ?? 'cuenta';
  const { summary } = client;
  const owes = summary.balanceCents > 0;
  const overdue = summary.overdueCents > 0 && summary.daysOverdue > 0;

  const greeting = `Hola ${client.contactName || client.name}, le escribimos de Plagamix.`;
  const wa = whatsappLink(client.phone, owes ? debtReminderText(client.name, summary.balanceCents) : greeting);

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/clientes" className="font-semibold text-muted hover:text-ink hover:underline">
          ← Clientes
        </Link>
      </p>

      <header className="grid gap-6 border-t-4 border-ink pt-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="label-caps">
            {KIND_LABELS[client.kind] ?? client.kind}
            {client.area ? ` · ${client.area}` : ''}
            {client.archived ? ' · Archivado' : ''}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-4xl">{client.name}</h1>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {client.contactName ? <li className="text-muted">{client.contactName}</li> : null}
            {client.phone ? (
              <li>
                <a href={`tel:${client.phone.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-8 items-center gap-1 font-semibold hover:underline">
                  <Phone size={14} aria-hidden /> {client.phone}
                </a>
              </li>
            ) : null}
            {client.address ? (
              <li>
                <a
                  href={mapsLink(client.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-8 items-center gap-1 font-semibold hover:underline"
                >
                  <MapPin size={14} aria-hidden /> {client.address}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="lg:col-span-5 lg:text-right">
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
            delta={overdue ? `Antigüedad: ${BUCKET_LABELS[summary.agingBucket]}` : undefined}
          />
        </div>
      </header>

      <div className="sticky top-14 z-20 -mx-4 mt-6 border-y border-ink bg-paper px-4 py-2 md:-mx-8 md:px-8 lg:top-0 lg:-mx-10 lg:px-10">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {client.archived ? (
            <Button
              variant="accent"
              disabled={unarchive.isPending}
              onClick={() => unarchive.mutate(client.id, { onSuccess: () => toast.success('Cliente restaurado') })}
            >
              Restaurar cliente
            </Button>
          ) : null}
          <Button variant={client.archived ? 'outline' : 'accent'} onClick={() => open({ type: 'payment', clientId: client.id })}>
            Registrar pago
          </Button>
          <Button variant="outline" onClick={() => open({ type: 'invoice', clientId: client.id })}>
            Nueva factura
          </Button>
          <Button variant="outline" onClick={() => open({ type: 'visit', clientId: client.id })}>
            Agendar visita
          </Button>
          {wa ? (
            <AnchorButton variant="outline" href={wa} target="_blank" rel="noreferrer" icon={<MessageCircle size={16} aria-hidden />}>
              WhatsApp
            </AnchorButton>
          ) : null}
          <Button variant="outline" onClick={() => setLinkOpen(true)}>
            Link público
          </Button>
          <LinkButton variant="outline" to={`/clientes/${client.id}/cartel`}>
            Imprimir QR
          </LinkButton>
          <Button variant="outline" onClick={() => open({ type: 'clientEdit', clientId: client.id })}>
            Editar
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <Tabs
          label="Secciones del cliente"
          tabs={TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={tab}
          onChange={(next) =>
            setParams(
              (current) => {
                const copy = new URLSearchParams(current);
                if (next === 'cuenta') copy.delete('tab');
                else copy.set('tab', next);
                return copy;
              },
              { replace: true },
            )
          }
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
          {tab === 'datos' ? (
            <DataTab client={client} />
          ) : tab === 'mails' ? (
            <EmailLogList clientId={client.id} showFilter={false} />
          ) : statementError ? (
            <ErrorNote message={errorMessage(statementError)} />
          ) : !statement ? (
            <Loading />
          ) : tab === 'cuenta' ? (
            <AccountTab statement={statement} />
          ) : tab === 'visitas' ? (
            <VisitsTab statement={statement} />
          ) : tab === 'facturas' ? (
            <InvoicesTab statement={statement} />
          ) : (
            <CertificatesTab statement={statement} />
          )}
        </div>
      </div>
      {linkOpen ? <PublicLinkSheet clientId={client.id} onClose={() => setLinkOpen(false)} /> : null}
    </div>
  );
}
