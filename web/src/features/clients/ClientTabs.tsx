import { daysLeftLabel, dayMonth, fullDate, FREQUENCY_LABELS, KIND_LABELS, METHOD_LABELS, money, overdueLabel } from '../../lib/format';
import type { PaymentMethod } from '@fumigadora/shared';
import { Button } from '../../ui/Button';
import { EmptyState, Table, Tag, type Column } from '../../ui/display';
import { useActions } from '../actions/ActionsProvider';
import type { Certificate, ClientDetail, Invoice, LedgerEntry, Statement, Visit } from '../../lib/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="label-caps mb-2 !text-ink">{title}</h3>
      {children}
    </section>
  );
}

function methodLabel(reference: string): string {
  return METHOD_LABELS[reference as PaymentMethod] ?? reference;
}

/** Ledger with running balance, newest first. Invoices carry their derived status. */
export function AccountTab({ statement }: { statement: Statement }) {
  const invoices = new Map(statement.invoices.map((invoice) => [invoice.id, invoice]));
  const rows = [...statement.ledger].reverse();

  const columns: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Fecha', hideOnMobile: true, cell: (e) => <span className="num">{fullDate(e.date)}</span> },
    {
      key: 'concept',
      header: 'Concepto',
      primary: true,
      cell: (e) => {
        const invoice = e.type === 'invoice' ? invoices.get(e.id) : undefined;
        return (
          <div className="min-w-0">
            <p className="font-semibold">
              <span className="num mr-2 text-xs font-normal text-muted md:hidden">{fullDate(e.date)}</span>
              {e.type === 'invoice' ? `Factura ${e.reference}` : `Pago · ${methodLabel(e.reference)}`}
            </p>
            {e.description ? <p className="truncate text-xs text-muted">{e.description}</p> : null}
            {invoice ? (
              <p className="mt-0.5 text-xs">
                <Tag status={invoice.status} />
                {invoice.status === 'overdue' ? (
                  <span className="ml-2 font-semibold text-red">{overdueLabel(invoice.daysOverdue)}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'debit',
      header: 'Debe',
      align: 'right',
      cell: (e) => <span className="num">{e.debitCents ? money(e.debitCents) : '—'}</span>,
    },
    {
      key: 'credit',
      header: 'Haber',
      align: 'right',
      cell: (e) => <span className="num">{e.creditCents ? money(e.creditCents) : '—'}</span>,
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      cell: (e) => <span className={`num font-bold`}>{money(e.balanceCents)}</span>,
    },
  ];

  if (rows.length === 0) return <EmptyState title="Este cliente todavía no tiene movimientos." />;
  return (
    <Table
      caption="Cuenta corriente"
      columns={columns}
      rows={rows}
      rowKey={(e) => `${e.type}-${e.id}`}
      mobileCols="grid-cols-3"
      gridClass="md:grid-cols-[96px_minmax(0,2.4fr)_1fr_1fr_1fr]"
    />
  );
}

export function VisitsTab({ statement }: { statement: Statement }) {
  const { open } = useActions();
  const upcoming = statement.visits.filter((v) => v.status === 'scheduled').sort((a, b) => a.date.localeCompare(b.date));
  const history = statement.visits.filter((v) => v.status !== 'scheduled');

  const columns = (withAction: boolean): Column<Visit>[] => [
    {
      key: 'date',
      header: 'Fecha',
      cell: (v) => (
        <span className="num font-semibold">
          {fullDate(v.date)}
          {v.time ? ` · ${v.time}` : ''}
        </span>
      ),
    },
    {
      key: 'service',
      header: 'Servicio',
      primary: true,
      cell: (v) => (
        <div>
          <p className="font-semibold">{v.serviceTypeName}</p>
          {v.notes ? <p className="text-xs text-muted">{v.notes}</p> : null}
        </div>
      ),
    },
    { key: 'freq', header: 'Frecuencia', cell: (v) => FREQUENCY_LABELS[v.frequency] },
    {
      key: 'status',
      header: 'Estado',
      cell: (v) => <span className="label-caps !text-ink">{v.status === 'done' ? 'Realizada' : v.status === 'cancelled' ? 'Cancelada' : 'Programada'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      wide: true,
      cell: (v) =>
        withAction && v.status === 'scheduled' ? (
          <Button size="sm" onClick={() => open({ type: 'completeVisit', visit: v })}>
            Completar
          </Button>
        ) : null,
    },
  ];
  const grid = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_1fr_1fr_110px]';

  return (
    <>
      <Section title="Próximas">
        {upcoming.length === 0 ? (
          <EmptyState
            title="No hay visitas programadas."
            action={
              <Button size="sm" variant="outline" onClick={() => open({ type: 'visit', clientId: statement.client.id })}>
                Agendar visita
              </Button>
            }
          />
        ) : (
          <Table caption="Próximas visitas" columns={columns(true)} rows={upcoming} rowKey={(v) => v.id} gridClass={grid} />
        )}
      </Section>
      <Section title="Historial">
        {history.length === 0 ? (
          <EmptyState title="Sin visitas anteriores." />
        ) : (
          <Table caption="Historial de visitas" columns={columns(false)} rows={history} rowKey={(v) => v.id} gridClass={grid} />
        )}
      </Section>
    </>
  );
}

export function InvoicesTab({ statement }: { statement: Statement }) {
  const { open } = useActions();
  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Número',
      primary: true,
      cell: (i) => (
        <div>
          <p className="num font-bold">{i.number}</p>
          {i.description ? <p className="truncate text-xs text-muted">{i.description}</p> : null}
        </div>
      ),
    },
    { key: 'issued', header: 'Emisión', cell: (i) => <span className="num">{dayMonth(i.issuedOn)}</span> },
    {
      key: 'due',
      header: 'Vence',
      cell: (i) => (
        <span className={`num ${i.status === 'overdue' ? 'font-semibold text-red' : ''}`}>
          {dayMonth(i.dueOn)}
          {i.status === 'overdue' ? <span className="block text-xs">{overdueLabel(i.daysOverdue)}</span> : null}
        </span>
      ),
    },
    { key: 'amount', header: 'Importe', align: 'right', cell: (i) => <span className="num">{money(i.amountCents)}</span> },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      cell: (i) => <span className="num font-bold">{i.voided ? '—' : money(i.balanceCents)}</span>,
    },
    { key: 'status', header: 'Estado', cell: (i) => <Tag status={i.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      wide: true,
      cell: (i) =>
        !i.voided && i.balanceCents > 0 ? (
          <Button size="sm" variant="accent" onClick={() => open({ type: 'payment', clientId: i.clientId, invoiceId: i.id })}>
            Cobrar
          </Button>
        ) : null,
    },
  ];
  if (statement.invoices.length === 0) {
    return (
      <EmptyState
        title="Sin facturas."
        action={
          <Button size="sm" variant="outline" onClick={() => open({ type: 'invoice', clientId: statement.client.id })}>
            Nueva factura
          </Button>
        }
      />
    );
  }
  return (
    <Table
      caption="Facturas"
      columns={columns}
      rows={statement.invoices}
      rowKey={(i) => i.id}
      mobileCols="grid-cols-3"
      gridClass="md:grid-cols-[minmax(0,1.8fr)_72px_minmax(0,1fr)_1fr_1fr_100px_96px]"
    />
  );
}

export function CertificatesTab({ statement }: { statement: Statement }) {
  const columns: Column<Certificate>[] = [
    {
      key: 'number',
      header: 'Oblea',
      primary: true,
      cell: (c) => (
        <div>
          <p className="num font-bold">N.º {c.number}</p>
          <p className="text-xs text-muted">{c.serviceTypeName ?? 'Sin servicio asociado'}</p>
        </div>
      ),
    },
    { key: 'issued', header: 'Emitida', cell: (c) => <span className="num">{fullDate(c.issuedOn)}</span> },
    { key: 'expires', header: 'Vence', cell: (c) => <span className="num">{fullDate(c.expiresOn)}</span> },
    {
      key: 'status',
      header: 'Estado',
      cell: (c) =>
        c.superseded ? (
          <span className="label-caps">Reemplazada</span>
        ) : (
          <span className={`text-sm ${c.daysLeft <= 15 ? 'font-bold underline decoration-yellow decoration-4 underline-offset-4' : ''}`}>{daysLeftLabel(c.daysLeft)}</span>
        ),
    },
  ];
  if (statement.certificates.length === 0) return <EmptyState title="Sin obleas emitidas." />;
  return (
    <Table
      caption="Obleas"
      columns={columns}
      rows={statement.certificates}
      rowKey={(c) => c.id}
      gridClass="md:grid-cols-[minmax(0,2fr)_1fr_1fr_1.4fr]"
    />
  );
}

export function DataTab({ client }: { client: ClientDetail }) {
  const { open } = useActions();
  const fields: [string, string | null][] = [
    ['Tipo', KIND_LABELS[client.kind] ?? client.kind],
    ['Contacto', client.contactName],
    ['Teléfono', client.phone],
    ['Correo electrónico', client.email],
    ['Dirección', client.address],
    ['Zona', client.area],
    ['CUIT', client.taxId],
    ['Abono mensual', client.monthlyFeeCents ? money(client.monthlyFeeCents) : null],
    ['Notas', client.notes],
  ];
  return (
    <div>
      <dl className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="border-t border-rule pt-2">
            <dt className="label-caps">{label}</dt>
            <dd className="mt-1 whitespace-pre-line text-base">{value || <span className="text-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6">
        <Button variant="outline" onClick={() => open({ type: 'clientEdit', clientId: client.id })}>
          Editar datos
        </Button>
      </div>
    </div>
  );
}
