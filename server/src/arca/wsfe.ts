import type { ArcaInvoiceRequest, IsoDate } from '@fumigadora/shared';
import { ArcaError, dig, escapeXml, parseXml, text, throwOnFault, toArray, type XmlNode } from './xml.js';

export const WSFE_URLS = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const;

const NS = 'http://ar.gov.afip.dif.FEV1/';

export interface WsfeAuth {
  token: string;
  sign: string;
  cuit: string;
}

export interface ArcaMessage {
  code: number;
  msg: string;
}

const amount = (cents: number) => (cents / 100).toFixed(2);
const ymd = (d: IsoDate) => d.replace(/-/g, '');

function envelope(body: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">` +
    `<soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
  );
}

function authXml(a: WsfeAuth): string {
  return `<ar:Auth><ar:Token>${escapeXml(a.token)}</ar:Token><ar:Sign>${escapeXml(a.sign)}</ar:Sign><ar:Cuit>${a.cuit}</ar:Cuit></ar:Auth>`;
}

export const buildDummyRequest = () => envelope('<ar:FEDummy/>');

export const buildLastAuthorizedRequest = (a: WsfeAuth, ptoVta: number, cbteTipo: number) =>
  envelope(`<ar:FECompUltimoAutorizado>${authXml(a)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`);

export const buildConsultRequest = (a: WsfeAuth, ptoVta: number, cbteTipo: number, cbteNro: number) =>
  envelope(
    `<ar:FECompConsultar>${authXml(a)}<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
      `<ar:CbteNro>${cbteNro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq></ar:FECompConsultar>`,
  );

export function buildAuthorizeRequest(a: WsfeAuth, r: ArcaInvoiceRequest): string {
  const iva = r.iva.length
    ? `<ar:Iva>${r.iva
        .map((i) => `<ar:AlicIva><ar:Id>${i.id}</ar:Id><ar:BaseImp>${amount(i.baseImpCents)}</ar:BaseImp><ar:Importe>${amount(i.importeCents)}</ar:Importe></ar:AlicIva>`)
        .join('')}</ar:Iva>`
    : '';
  return envelope(
    `<ar:FECAESolicitar>${authXml(a)}<ar:FeCAEReq>` +
      `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${r.ptoVta}</ar:PtoVta><ar:CbteTipo>${r.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
      `<ar:FeDetReq><ar:FECAEDetRequest>` +
      `<ar:Concepto>${r.concepto}</ar:Concepto><ar:DocTipo>${r.docTipo}</ar:DocTipo><ar:DocNro>${r.docNro}</ar:DocNro>` +
      `<ar:CbteDesde>${r.cbteNro}</ar:CbteDesde><ar:CbteHasta>${r.cbteNro}</ar:CbteHasta><ar:CbteFch>${ymd(r.cbteFch)}</ar:CbteFch>` +
      `<ar:ImpTotal>${amount(r.impTotalCents)}</ar:ImpTotal><ar:ImpTotConc>${amount(r.impTotConcCents)}</ar:ImpTotConc>` +
      `<ar:ImpNeto>${amount(r.impNetoCents)}</ar:ImpNeto><ar:ImpOpEx>${amount(r.impOpExCents)}</ar:ImpOpEx>` +
      `<ar:ImpTrib>${amount(r.impTribCents)}</ar:ImpTrib><ar:ImpIVA>${amount(r.impIvaCents)}</ar:ImpIVA>` +
      `<ar:FchServDesde>${ymd(r.fchServDesde)}</ar:FchServDesde><ar:FchServHasta>${ymd(r.fchServHasta)}</ar:FchServHasta>` +
      `<ar:FchVtoPago>${ymd(r.fchVtoPago)}</ar:FchVtoPago><ar:MonId>${r.monId}</ar:MonId><ar:MonCotiz>${r.monCotiz}</ar:MonCotiz>` +
      `<ar:CondicionIVAReceptorId>${r.condicionIvaReceptorId}</ar:CondicionIVAReceptorId>${iva}` +
      `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>`,
  );
}

// ---------- responses ----------

function messages(node: unknown, itemKey: string): ArcaMessage[] {
  return toArray(node as XmlNode | XmlNode[] | undefined).flatMap((n) =>
    toArray(dig(n, itemKey) as XmlNode | XmlNode[] | undefined).map((m) => ({
      code: Number(text(dig(m, 'Code')) ?? 0),
      msg: text(dig(m, 'Msg')) ?? '',
    })),
  );
}

function result(doc: XmlNode, op: string): XmlNode {
  throwOnFault(doc);
  const r = dig(doc, `Envelope.Body.${op}Response.${op}Result`);
  if (!r || typeof r !== 'object') throw new ArcaError('Respuesta de ARCA inesperada', true);
  return r as XmlNode;
}

const errorsOf = (r: XmlNode) => messages(dig(r, 'Errors'), 'Err');

export function parseDummyResponse(xml: string): { appServer: string; dbServer: string; authServer: string } {
  const r = result(parseXml(xml), 'FEDummy');
  return {
    appServer: text(dig(r, 'AppServer')) ?? '',
    dbServer: text(dig(r, 'DbServer')) ?? '',
    authServer: text(dig(r, 'AuthServer')) ?? '',
  };
}

export function parseLastAuthorizedResponse(xml: string): { lastNumber: number; errors: ArcaMessage[] } {
  const r = result(parseXml(xml), 'FECompUltimoAutorizado');
  return { lastNumber: Number(text(dig(r, 'CbteNro')) ?? 0), errors: errorsOf(r) };
}

export interface AuthorizeResult {
  /** A approved, R rejected, P partial. */
  resultado: 'A' | 'R' | 'P';
  cae: string | null;
  caeDueOn: IsoDate | null;
  cbteNro: number | null;
  observations: ArcaMessage[];
  errors: ArcaMessage[];
  events: ArcaMessage[];
}

const isoFromYmd = (s: string | null): IsoDate | null => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

export function parseAuthorizeResponse(xml: string): AuthorizeResult {
  const r = result(parseXml(xml), 'FECAESolicitar');
  const det = toArray(dig(r, 'FeDetResp.FEDetResponse') as XmlNode | XmlNode[] | undefined)[0];
  const errors = errorsOf(r);
  const raw = text(dig(det, 'Resultado')) ?? text(dig(r, 'FeCabResp.Resultado'));
  const resultado = raw === 'A' || raw === 'P' ? raw : 'R';
  const cae = text(dig(det, 'CAE'));
  return {
    resultado: resultado === 'A' && !cae ? 'R' : resultado,
    cae,
    caeDueOn: isoFromYmd(text(dig(det, 'CAEFchVto'))),
    cbteNro: det ? Number(text(dig(det, 'CbteDesde')) ?? 0) || null : null,
    observations: messages(dig(det, 'Obs'), 'Observaciones'),
    errors,
    events: messages(dig(r, 'Events'), 'Evt'),
  };
}

export interface ConsultResult {
  found: boolean;
  cae: string | null;
  caeDueOn: IsoDate | null;
  cbteFch: IsoDate | null;
  totalCents: number | null;
  docTipo: number | null;
  docNro: string | null;
  resultado: string | null;
  errors: ArcaMessage[];
}

export function parseConsultResponse(xml: string): ConsultResult {
  const r = result(parseXml(xml), 'FECompConsultar');
  const got = dig(r, 'ResultGet');
  const cae = text(dig(got, 'CodAutorizacion'));
  const total = text(dig(got, 'ImpTotal'));
  return {
    found: Boolean(got) && Boolean(cae),
    cae,
    caeDueOn: isoFromYmd(text(dig(got, 'FchVto'))),
    cbteFch: isoFromYmd(text(dig(got, 'CbteFch'))),
    totalCents: total === null ? null : Math.round(Number(total) * 100),
    docTipo: text(dig(got, 'DocTipo')) === null ? null : Number(text(dig(got, 'DocTipo'))),
    docNro: text(dig(got, 'DocNro')),
    resultado: text(dig(got, 'Resultado')),
    errors: errorsOf(r),
  };
}

export async function soapCall(fetchFn: typeof fetch, url: string, operation: string, body: string): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'text/xml;charset=UTF-8', soapaction: `${NS}${operation}` },
      body,
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    // The request may or may not have been processed: callers must reconcile before retrying.
    throw new ArcaError(`No se pudo conectar con ARCA: ${(e as Error).message}`, true);
  }
  const xml = await res.text().catch(() => '');
  if (!res.ok && !xml.includes('Fault')) throw new ArcaError(`ARCA respondió HTTP ${res.status}`, true);
  return xml;
}
