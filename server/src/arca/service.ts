import { eq } from 'drizzle-orm';
import {
  ARCA_CBTE,
  ArcaMappingError,
  maskCuit,
  mapInvoiceToArca,
  type ArcaInvoiceRequest,
  type IsoDate,
} from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, invoices } from '../db/schema.js';
import { badRequest, conflict, notFound, type Deps } from '../http.js';
import { getInvoice } from '../services/invoices.js';
import { getSettings } from '../services/settings.js';
import { ArcaClient, formatMessages } from './client.js';
import { ArcaError } from './xml.js';
import type { ArcaMessage } from './wsfe.js';

type ArcaDeps = Pick<Deps, 'db' | 'config' | 'today' | 'fetch'>;

export function arcaClient(deps: ArcaDeps): ArcaClient | null {
  const a = deps.config.arca;
  if (!a.configured || !a.env || !a.cuit || !a.cert || !a.key || !a.ptoVta || !a.taxCondition) return null;
  return new ArcaClient(deps.db, { env: a.env, cuit: a.cuit, cert: a.cert, key: a.key, ptoVta: a.ptoVta, taxCondition: a.taxCondition }, deps.fetch ?? fetch);
}

/** Never exposes the certificate, the key or any token. */
export function arcaStatus(deps: Pick<Deps, 'config'>) {
  const a = deps.config.arca;
  return {
    configured: a.configured,
    env: a.env ?? null,
    cuit: a.cuit ? maskCuit(a.cuit) : null,
    ptoVta: a.ptoVta ?? null,
    taxCondition: a.taxCondition ?? null,
    missing: a.missing,
  };
}

/** Class of invoice the connection test asks about. */
const probeTipo = (c: 'monotributo' | 'responsable_inscripto') => (c === 'monotributo' ? ARCA_CBTE.C : ARCA_CBTE.A);

export interface CheckStep {
  name: 'dummy' | 'login' | 'last_authorized';
  ok: boolean;
  detail: string;
}

/** FEDummy + WSAA login + FECompUltimoAutorizado. Never throws; reports each step. */
export async function checkArca(deps: ArcaDeps) {
  const client = arcaClient(deps);
  if (!client) throw conflict('ARCA no está configurado', 'arca_not_configured');
  const steps: CheckStep[] = [];
  const run = async (name: CheckStep['name'], fn: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, detail: await fn() });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: e instanceof Error ? e.message : 'Error desconocido' });
      return false;
    }
  };
  const a = deps.config.arca;
  const okDummy = await run('dummy', async () => {
    const d = await client.dummy();
    if (d.appServer !== 'OK' || d.dbServer !== 'OK' || d.authServer !== 'OK') {
      throw new ArcaError(`Servicios de ARCA con problemas (app ${d.appServer}, db ${d.dbServer}, auth ${d.authServer})`);
    }
    return 'Servicios de ARCA disponibles';
  });
  const okLogin =
    okDummy &&
    (await run('login', async () => {
      await client.login();
      return 'Autenticación correcta (certificado aceptado)';
    }));
  if (okLogin) {
    await run('last_authorized', async () => `Último comprobante autorizado: ${await client.lastAuthorized(probeTipo(a.taxCondition!))}`);
  }
  return { ok: steps.length === 3 && steps.every((s) => s.ok), steps };
}

// ---------- emission ----------

/** Numbering is sequential per point of sale and type: one emission at a time in this process. */
let emitChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = emitChain.then(fn, fn);
  emitChain = next.catch(() => undefined);
  return next;
}

interface StoredDetails {
  observations: ArcaMessage[];
  errors: ArcaMessage[];
  message?: string;
}

const detailsJson = (d: StoredDetails) => JSON.stringify(d);

async function markAuthorized(
  db: Db,
  id: number,
  v: { cbteTipo: number; ptoVta: number; cbteNro: number; cae: string; caeDueOn: IsoDate | null; observations: ArcaMessage[] },
) {
  await db
    .update(invoices)
    .set({
      arcaStatus: 'authorized',
      cbteType: v.cbteTipo,
      ptoVta: v.ptoVta,
      cbteNumber: v.cbteNro,
      cae: v.cae,
      caeDueOn: v.caeDueOn,
      arcaObservations: v.observations.length ? detailsJson({ observations: v.observations, errors: [] }) : null,
    })
    .where(eq(invoices.id, id));
}

/**
 * Emits one invoice in ARCA. Idempotent: an authorized invoice is refused (409), and a retry after an
 * unknown outcome first reconciles with ARCA (see docs/arca.md) so no duplicate comprobante is created.
 * ARCA/network failures are stored on the invoice (`error` / `rejected`) and the invoice view is returned.
 */
export function emitInvoice(deps: ArcaDeps, invoiceId: number) {
  return exclusive(() => emitNow(deps, invoiceId));
}

async function emitNow(deps: ArcaDeps, invoiceId: number) {
  const { db, config } = deps;
  const client = arcaClient(deps);
  if (!client) throw conflict('ARCA no está configurado todavía', 'arca_not_configured');
  const today = deps.today();

  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound('Factura');
  if (inv.voidedAt) throw conflict('La factura está anulada');
  if (inv.arcaStatus === 'authorized') throw conflict('La factura ya está autorizada en ARCA', 'already_authorized');
  const [client_] = await db.select().from(clients).where(eq(clients.id, inv.clientId));
  if (!client_) throw notFound('Cliente');

  const base = {
    issuerCondition: config.arca.taxCondition!,
    ptoVta: config.arca.ptoVta!,
    today,
    invoice: { amountCents: inv.amountCents, issuedOn: inv.issuedOn, dueOn: inv.dueOn, periodMonth: inv.periodMonth },
    client: { taxDocType: client_.taxDocType, taxDocNumber: client_.taxDocNumber, ivaCondition: client_.ivaCondition },
  };
  let probe: ArcaInvoiceRequest;
  try {
    probe = mapInvoiceToArca({ ...base, cbteNro: 1 });
  } catch (e) {
    if (e instanceof ArcaMappingError) throw badRequest(e.message, 'arca_invalid_data');
    throw e;
  }

  const fail = async (status: 'error' | 'rejected', details: StoredDetails) => {
    await db.update(invoices).set({ arcaStatus: status, arcaObservations: detailsJson(details) }).where(eq(invoices.id, invoiceId));
    return getInvoice(db, today, invoiceId);
  };

  try {
    const last = await client.lastAuthorized(probe.cbteTipo);

    // Reconcile a previous attempt whose outcome is unknown: if ARCA already holds that number for this
    // very invoice (same total and receptor document), adopt its CAE instead of creating a duplicate.
    const prev = inv.arcaAttemptedNumber;
    if (inv.arcaStatus === 'error' && prev && inv.cbteType === probe.cbteTipo && last >= prev) {
      const found = await client.consult(probe.cbteTipo, prev);
      if (found.found && found.cae && found.totalCents === inv.amountCents && found.docNro === probe.docNro && found.docTipo === probe.docTipo) {
        await markAuthorized(db, invoiceId, {
          cbteTipo: probe.cbteTipo,
          ptoVta: base.ptoVta,
          cbteNro: prev,
          cae: found.cae,
          caeDueOn: found.caeDueOn,
          observations: [],
        });
        return getInvoice(db, today, invoiceId);
      }
    }

    const cbteNro = last + 1;
    const request = mapInvoiceToArca({ ...base, cbteNro });
    // Recorded BEFORE the call: if the process dies or the answer is lost, a retry can reconcile.
    await db
      .update(invoices)
      .set({
        arcaStatus: 'error',
        arcaObservations: detailsJson({ observations: [], errors: [], message: 'Intento de envío sin respuesta confirmada' }),
        arcaAttemptedAt: new Date(),
        arcaAttemptedNumber: cbteNro,
        cbteType: request.cbteTipo,
        ptoVta: request.ptoVta,
      })
      .where(eq(invoices.id, invoiceId));

    const res = await client.authorize(request);
    if (res.resultado === 'A' && res.cae) {
      await markAuthorized(db, invoiceId, {
        cbteTipo: request.cbteTipo,
        ptoVta: request.ptoVta,
        cbteNro: res.cbteNro ?? cbteNro,
        cae: res.cae,
        caeDueOn: res.caeDueOn,
        observations: res.observations,
      });
      return getInvoice(db, today, invoiceId);
    }
    return fail('rejected', {
      observations: res.observations,
      errors: res.errors,
      message: formatMessages([...res.errors, ...res.observations]) || 'ARCA rechazó el comprobante',
    });
  } catch (e) {
    if (e instanceof ArcaMappingError) throw badRequest(e.message, 'arca_invalid_data');
    const message = e instanceof Error ? e.message : 'Error desconocido';
    return fail('error', { observations: [], errors: [], message });
  }
}

// ---------- optional auto emission ----------

const pending = new Set<Promise<unknown>>();

/**
 * After an invoice-creating flow commits, emits the new invoices in the background when ARCA is configured
 * and the `arcaAutoEmit` setting is on. Failures never break the flow: the invoice keeps its ARCA status.
 */
export function queueAutoEmit(deps: ArcaDeps, invoiceIds: number[]): void {
  if (invoiceIds.length === 0 || !deps.config.arca.configured) return;
  const job = (async () => {
    try {
      if (!(await getSettings(deps.db)).arcaAutoEmit) return;
      for (const id of invoiceIds) {
        try {
          await emitInvoice(deps, id);
        } catch (e) {
          console.error('[arca] auto emit failed for invoice', id, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.error('[arca] auto emit aborted', e instanceof Error ? e.message : e);
    }
  })();
  pending.add(job);
  void job.finally(() => pending.delete(job));
}

/** Waits for background emissions (tests, shutdown). */
export async function flushAutoEmit(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
