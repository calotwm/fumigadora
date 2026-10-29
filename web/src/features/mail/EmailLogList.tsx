import { useState } from 'react';
import { useEmailDetail, useEmailLog } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { fullDate } from '../../lib/format';
import type { EmailKind, EmailLogItem } from '../../lib/types';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorNote, Loading } from '../../ui/display';
import { Chips } from '../../ui/form';
import { Sheet } from '../../ui/Sheet';

export const KIND_LABEL: Record<EmailKind, string> = {
  service_notice: 'Aviso de servicio',
  debt_reminder: 'Recordatorio de deuda',
  test: 'Prueba',
  owner_notification: 'Aviso interno',
};

const STATUS_LABEL = { sent: 'Enviado', simulated: 'Simulado', failed: 'Falló el envío' } as const;

type KindFilter = 'all' | EmailKind;
const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'service_notice', label: 'Avisos de servicio' },
  { value: 'debt_reminder', label: 'Recordatorios' },
  { value: 'test', label: 'Pruebas' },
  { value: 'owner_notification', label: 'Avisos internos' },
];

/** Paged list of sent/simulated/failed emails with an HTML preview. Optionally scoped to one client. */
export function EmailLogList({ clientId, showFilter = true }: { clientId?: number; showFilter?: boolean }) {
  const [kind, setKind] = useState<KindFilter>('all');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<number | null>(null);
  const query = useEmailLog({ kind: kind === 'all' ? undefined : kind, clientId, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      {showFilter ? (
        <Chips
          label="Tipo"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
        />
      ) : null}
      {query.isLoading ? (
        <Loading />
      ) : query.error || !data ? (
        <ErrorNote message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState title="Todavía no se envió ningún mail." />
      ) : (
        <>
          <ul className="border-t border-ink">
            {data.items.map((item) => (
              <li key={item.id} className="border-b border-rule">
                <button
                  type="button"
                  onClick={() => setPreview(item.id)}
                  className="grid w-full min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3 text-left hover:bg-paper-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{item.subject}</span>
                    <span className="block truncate text-xs text-muted">
                      {KIND_LABEL[item.kind]} · {item.to}
                      {item.clientName && !clientId ? ` · ${item.clientName}` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={`block text-xs font-semibold ${item.status === 'failed' ? 'underline' : ''}`}>{STATUS_LABEL[item.status]}</span>
                    <span className="num block text-xs text-muted">{fullDate(item.sentOn)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-3">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <span className="num text-sm text-muted">
                Página {page} de {pages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Siguiente
              </Button>
            </div>
          ) : null}
        </>
      )}
      {preview !== null ? <EmailPreviewSheet id={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function EmailPreviewSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useEmailDetail(id);
  const mail: EmailLogItem | undefined = detail.data;
  return (
    <Sheet title="Vista previa del mail" onClose={onClose}>
      {detail.isLoading ? (
        <Loading />
      ) : detail.error || !mail ? (
        <ErrorNote message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="label-caps">Para</dt>
            <dd className="min-w-0 break-words">{mail.to}</dd>
            <dt className="label-caps">Asunto</dt>
            <dd className="min-w-0 break-words font-semibold">{mail.subject}</dd>
            <dt className="label-caps">Estado</dt>
            <dd>{STATUS_LABEL[mail.status]}</dd>
            {mail.error ? (
              <>
                <dt className="label-caps">Error</dt>
                <dd className="min-w-0 break-words">{mail.error}</dd>
              </>
            ) : null}
          </dl>
          <iframe
            title="Contenido del mail"
            sandbox=""
            srcDoc={mail.html ?? ''}
            className="h-[60dvh] w-full border border-rule bg-white"
          />
        </div>
      )}
    </Sheet>
  );
}
