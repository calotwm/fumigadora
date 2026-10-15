import { useState } from 'react';
import { useArcaCheck, useArcaStatus, useSaveSettings, useSettings } from '../../lib/queries';
import { errorMessage } from '../../lib/api';
import { TAX_CONDITION_LABELS } from '../../lib/format';
import type { ArcaCheckResult } from '../../lib/types';
import { Button } from '../../ui/Button';
import { ErrorNote, Loading, SectionHead } from '../../ui/display';
import { Checkbox } from '../../ui/form';
import { useToast } from '../../ui/Toast';

const REQUIREMENTS = [
  { vars: ['ARCA_CERT', 'ARCA_KEY'], title: 'Certificado digital', hint: 'Certificado y clave privada generados en ARCA para el CUIT, habilitados para el servicio de facturación electrónica.' },
  { vars: ['ARCA_PTO_VTA'], title: 'Punto de venta web service', hint: 'Un punto de venta de tipo "Factura Electrónica - Web Services" habilitado en ARCA.' },
  { vars: ['ARCA_TAX_CONDITION'], title: 'Condición fiscal', hint: 'Monotributo (Factura C) o Responsable Inscripto (Factura A/B).' },
  { vars: ['ARCA_CUIT', 'ARCA_ENV'], title: 'CUIT y ambiente', hint: 'CUIT de la empresa y ambiente: homologación (pruebas) o producción.' },
];

const STEP_LABELS: Record<ArcaCheckResult['steps'][number]['name'], string> = {
  dummy: 'Servicios de ARCA',
  login: 'Autenticación con el certificado',
  last_authorized: 'Consulta del último comprobante',
};

/** Ajustes > Facturación electrónica (ARCA): activation status, connection test and auto-emit switch. */
export function ArcaSection() {
  const status = useArcaStatus();
  const settings = useSettings();
  const save = useSaveSettings();
  const check = useArcaCheck();
  const toast = useToast();
  const [result, setResult] = useState<ArcaCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  return (
    <section aria-label="Facturación electrónica (ARCA)" className="lg:col-span-2">
      <SectionHead title="Facturación electrónica (ARCA)" />
      {status.isLoading ? (
        <Loading />
      ) : status.error || !status.data ? (
        <ErrorNote message={errorMessage(status.error)} onRetry={() => status.refetch()} />
      ) : !status.data.configured ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="self-start border-l-4 border-yellow bg-paper-2 px-4 py-4 text-sm">
            <p className="text-base font-bold">Pendiente de activación</p>
            <p className="mt-1 text-muted">
              Las facturas se siguen cargando como siempre. Cuando se complete la configuración, podrá emitirlas en ARCA con un botón (o
              automáticamente) y obtener el CAE.
            </p>
          </div>
          <div>
            <h3 className="label-caps mb-2 !text-ink">Qué falta</h3>
            <ul className="border-t border-ink">
              {REQUIREMENTS.map((item) => {
                const missing = item.vars.filter((v) => status.data.missing.includes(v));
                const done = missing.length === 0;
                return (
                  <li key={item.title} className="flex gap-3 border-b border-rule py-3">
                    <span
                      aria-hidden
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border border-ink text-xs font-bold ${done ? 'bg-yellow' : 'bg-paper'}`}
                    >
                      {done ? '✓' : ''}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">
                        {item.title} <span className="sr-only">{done ? '(listo)' : '(pendiente)'}</span>
                      </p>
                      <p className="text-xs text-muted">{item.hint}</p>
                      {!done ? (
                        <p className="mt-1 text-xs">
                          Variables a configurar en el servidor:{' '}
                          {missing.map((v) => (
                            <code key={v} className="mr-1 font-semibold">
                              {v}
                            </code>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              {[
                ['Estado', 'Activa'],
                ['Ambiente', status.data.env === 'produccion' ? 'Producción' : 'Homologación (pruebas)'],
                ['CUIT', status.data.cuit ?? '—'],
                ['Punto de venta', String(status.data.ptoVta ?? '—').padStart(4, '0')],
                ['Condición fiscal', status.data.taxCondition ? (TAX_CONDITION_LABELS[status.data.taxCondition] ?? status.data.taxCondition) : '—'],
                ['Comprobante', status.data.taxCondition === 'monotributo' ? 'Factura C' : 'Factura A o B'],
              ].map(([label, value]) => (
                <div key={label} className="border-t border-rule pt-2">
                  <dt className="label-caps">{label}</dt>
                  <dd className="num mt-1 text-base font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            {status.data.env === 'homologacion' ? (
              <p className="mt-3 text-xs text-muted">Ambiente de pruebas: los comprobantes no tienen validez fiscal.</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <Button
                variant="outline"
                disabled={check.isPending}
                onClick={() => {
                  setCheckError(null);
                  check.mutate(undefined, {
                    onSuccess: (r) => {
                      setResult(r);
                      if (r.ok) toast.success('Conexión con ARCA correcta');
                    },
                    onError: (e) => setCheckError(errorMessage(e)),
                  });
                }}
              >
                {check.isPending ? 'Probando…' : 'Probar conexión'}
              </Button>
              {checkError ? (
                <p role="alert" className="mt-2 text-xs text-red">
                  {checkError}
                </p>
              ) : null}
              {result ? (
                <ul className="mt-3 border-t border-ink" aria-label="Resultado de la prueba">
                  {result.steps.map((step) => (
                    <li key={step.name} className="flex gap-2 border-b border-rule py-2 text-sm">
                      <span className={`label-caps ${step.ok ? '!text-ink' : '!text-red'}`}>{step.ok ? 'OK' : 'Error'}</span>
                      <span className="min-w-0">
                        <span className="font-semibold">{STEP_LABELS[step.name]}</span>
                        <span className={`block text-xs ${step.ok ? 'text-muted' : 'text-red'}`}>{step.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {settings.data ? (
              <Checkbox
                label="Emitir automáticamente en ARCA"
                hint="Las facturas nuevas (manuales, de visitas y de abonos) se emiten solas. Si falla, quedan para reintentar."
                checked={settings.data.arcaAutoEmit}
                disabled={save.isPending}
                onChange={(checked) =>
                  save.mutate({ arcaAutoEmit: checked }, { onSuccess: () => toast.success(checked ? 'Emisión automática activada' : 'Emisión automática desactivada') })
                }
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
