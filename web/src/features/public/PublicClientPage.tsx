import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone } from 'lucide-react';
import { ApiError, api } from '../../lib/api';
import { daysLeftLabel, fullDate, longDate } from '../../lib/format';
import { whatsappLink } from '../../lib/whatsapp';
import { AnchorButton } from '../../ui/Button';
import type { PublicClientView } from '../../lib/types';
import plagamixBlack from '../../assets/plagamix-black.png';

/** `/c/:token`: what the QR placard opens. No login; the server only sends non-sensitive data. */
export function PublicClientPage() {
  const token = useParams().token ?? '';
  const view = useQuery({
    queryKey: ['public-client', token],
    queryFn: () => api<PublicClientView>(`/public/clients/${encodeURIComponent(token)}`),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col bg-paper">
      <header className="bg-yellow px-6 py-6">
        <img src={plagamixBlack} alt="Plagamix" width={374} height={100} className="h-auto w-44" />
      </header>
      {view.isLoading ? (
        <p role="status" className="p-6 text-sm text-muted">
          Cargando…
        </p>
      ) : view.error instanceof ApiError && view.error.status === 404 ? (
        <section className="px-6 py-10">
          <h1 className="text-2xl font-extrabold tracking-tight">Este enlace ya no es válido</h1>
          <p className="mt-2 text-sm text-muted">Puede que el código se haya reemplazado. Consultá a la administración del edificio o a Plagamix.</p>
        </section>
      ) : view.error || !view.data ? (
        <p role="alert" className="p-6 text-sm text-red">
          No se pudo cargar la información. Probá de nuevo en unos minutos.
        </p>
      ) : (
        <PublicContent data={view.data} />
      )}
    </main>
  );
}

function PublicContent({ data }: { data: PublicClientView }) {
  const { nextVisit, certificate, lastVisitDate, company } = data;
  const wa = whatsappLink(company.phone, `Hola, consulto por el servicio de ${data.name}.`);
  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="border-t-4 border-ink pt-3">
        <p className="label-caps">Servicio de control de plagas</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{data.name}</h1>
      </div>

      <section aria-label="Próxima visita">
        <p className="label-caps">Próxima visita</p>
        {nextVisit ? (
          <>
            <p className="mt-1 text-4xl font-extrabold tracking-tight">{longDate(nextVisit.date)}</p>
            <p className="mt-1 text-sm text-muted">
              {nextVisit.serviceTypeName}
              {nextVisit.time ? ` · ${nextVisit.time} hs` : ''}
            </p>
          </>
        ) : (
          <p className="mt-1 text-base">Todavía no hay una visita programada.</p>
        )}
        {lastVisitDate ? <p className="mt-3 text-sm text-muted">Última visita: {fullDate(lastVisitDate)}</p> : null}
      </section>

      <section aria-label="Oblea">
        <p className="label-caps">Oblea vigente</p>
        {certificate ? (
          <div className="mt-2 border border-ink p-4">
            <p className={`text-xl font-extrabold ${certificate.valid ? '' : 'text-red'}`}>
              {certificate.valid ? 'Vigente' : 'Vencida'} · hasta {fullDate(certificate.expiresOn)}
            </p>
            <p className="mt-1 text-sm text-muted">
              N.º {certificate.number} · {daysLeftLabel(certificate.daysLeft)}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-base">Todavía no hay una oblea registrada.</p>
        )}
      </section>

      {company.phone ? (
        <section aria-label="Contacto" className="mt-auto flex flex-col gap-2 border-t border-rule pt-6">
          <p className="label-caps">Contacto {company.name}</p>
          <div className="flex flex-wrap gap-2">
            <AnchorButton variant="outline" href={`tel:${company.phone.replace(/[^\d+]/g, '')}`} icon={<Phone size={16} aria-hidden />}>
              Llamar
            </AnchorButton>
            {wa ? (
              <AnchorButton variant="outline" href={wa} target="_blank" rel="noreferrer" icon={<MessageCircle size={16} aria-hidden />}>
                WhatsApp
              </AnchorButton>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
