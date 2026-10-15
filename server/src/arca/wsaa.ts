import forge from 'node-forge';
import { ArcaError, dig, escapeXml, parseXml, text, throwOnFault } from './xml.js';

export const WSAA_URLS = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;

/** Service id of the TRA for the electronic invoice web service (WSFEv1). */
export const WSFE_SERVICE_ID = 'wsfe';

/** Argentina has no DST: UTC-3 all year. */
function arTime(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 3600_000);
  return `${shifted.toISOString().slice(0, 23)}-03:00`;
}

/** Login ticket request, valid 10 minutes around `now` (the clock of the server must be in sync). */
export function buildTra(now: Date, service = WSFE_SERVICE_ID): string {
  const from = new Date(now.getTime() - 10 * 60_000);
  const to = new Date(now.getTime() + 10 * 60_000);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${arTime(from)}</generationTime>` +
    `<expirationTime>${arTime(to)}</expirationTime>` +
    `</header><service>${escapeXml(service)}</service></loginTicketRequest>`
  );
}

/** CMS (PKCS#7 SignedData, content attached, SHA-256, certificate included), base64 encoded. */
export function signTra(tra: string, certPem: string, keyPem: string, now = new Date()): string {
  let cert: forge.pki.Certificate;
  let key: forge.pki.PrivateKey;
  try {
    cert = forge.pki.certificateFromPem(certPem);
    key = forge.pki.privateKeyFromPem(keyPem);
  } catch {
    throw new ArcaError('El certificado o la clave privada de ARCA no tienen un formato PEM válido');
  }
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: key as forge.pki.rsa.PrivateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: now as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export function buildLoginCmsEnvelope(cmsBase64: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body>' +
    `<wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  );
}

export interface AccessTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

/** Parses the SOAP answer of `loginCms` (the ticket arrives as escaped XML inside `loginCmsReturn`). */
export function parseLoginCmsResponse(xml: string): AccessTicket {
  const doc = parseXml(xml);
  throwOnFault(doc);
  const inner = text(dig(doc, 'Envelope.Body.loginCmsResponse.loginCmsReturn'));
  if (!inner) throw new ArcaError('El servicio de autenticación de ARCA no devolvió un ticket');
  const ticket = parseXml(inner);
  const token = text(dig(ticket, 'loginTicketResponse.credentials.token'));
  const sign = text(dig(ticket, 'loginTicketResponse.credentials.sign'));
  const exp = text(dig(ticket, 'loginTicketResponse.header.expirationTime'));
  const expiresAt = exp ? new Date(exp) : null;
  if (!token || !sign || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new ArcaError('El ticket de acceso de ARCA es inválido');
  }
  return { token, sign, expiresAt };
}

export async function requestAccessTicket(
  fetchFn: typeof fetch,
  url: string,
  certPem: string,
  keyPem: string,
  now = new Date(),
): Promise<AccessTicket> {
  const cms = signTra(buildTra(now), certPem, keyPem, now);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'text/xml;charset=UTF-8', soapaction: 'urn:LoginCms' },
      body: buildLoginCmsEnvelope(cms),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ArcaError(`No se pudo conectar con la autenticación de ARCA: ${(e as Error).message}`);
  }
  // SOAP faults come with HTTP 500 and a parseable body; parse first so the fault message is surfaced.
  const body = await res.text();
  if (!res.ok && !body.includes('Fault')) throw new ArcaError(`La autenticación de ARCA respondió HTTP ${res.status}`);
  return parseLoginCmsResponse(body);
}
