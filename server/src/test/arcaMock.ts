import forge from 'node-forge';
import { loadArcaConfig } from '../config.js';

export const TEST_CUIT = '20123456786';

export function makeTestCertificate() {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: 'plagamix-test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey), cert };
}

let cached: ReturnType<typeof makeTestCertificate> | undefined;
export const testCertificate = () => (cached ??= makeTestCertificate());

export function arcaEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const { certPem, keyPem } = testCertificate();
  return {
    ARCA_ENV: 'homologacion',
    ARCA_CUIT: '20-12345678-6',
    // Escaped newlines, as pasted in a hosting dashboard.
    ARCA_CERT: certPem.replace(/\r?\n/g, '\\n'),
    ARCA_KEY: Buffer.from(keyPem).toString('base64'),
    ARCA_PTO_VTA: '3',
    ARCA_TAX_CONDITION: 'monotributo',
    ...overrides,
  };
}

export const arcaConfigFor = (overrides: Record<string, string | undefined> = {}) => loadArcaConfig(arcaEnv(overrides));

// ---------- SOAP answers ----------

export function loginResponse(expires = new Date(Date.now() + 12 * 3600_000)): string {
  const inner =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><loginTicketResponse version="1.0"><header><source>CN=wsaahomo</source>` +
    `<uniqueId>1</uniqueId><generationTime>2025-06-15T10:00:00.000-03:00</generationTime><expirationTime>${expires.toISOString()}</expirationTime></header>` +
    `<credentials><token>TOKEN-ABC</token><sign>SIGN-XYZ</sign></credentials></loginTicketResponse>`;
  const escaped = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${escaped}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;
}

const soap = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

export const dummyResponse = (status = 'OK') =>
  soap(`<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>${status}</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>`);

export const lastResponse = (ptoVta: number, tipo: number, nro: number) =>
  soap(
    `<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>${ptoVta}</PtoVta><CbteTipo>${tipo}</CbteTipo><CbteNro>${nro}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`,
  );

const msgs = (tag: string, item: string, list: { code: number; msg: string }[]) =>
  list.length ? `<${tag}>${list.map((m) => `<${item}><Code>${m.code}</Code><Msg>${m.msg}</Msg></${item}>`).join('')}</${tag}>` : '';

export function authorizeResponse(o: {
  resultado: 'A' | 'R';
  nro: number;
  cae?: string;
  due?: string;
  obs?: { code: number; msg: string }[];
  errors?: { code: number; msg: string }[];
  tipo?: number;
}): string {
  const obs = o.obs?.length ? `<Obs>${o.obs.map((m) => `<Observaciones><Code>${m.code}</Code><Msg>${m.msg}</Msg></Observaciones>`).join('')}</Obs>` : '';
  return soap(
    `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
      `<FeCabResp><Cuit>${TEST_CUIT}</Cuit><PtoVta>3</PtoVta><CbteTipo>${o.tipo ?? 11}</CbteTipo><FchProceso>20250615120000</FchProceso><CantReg>1</CantReg><Resultado>${o.resultado}</Resultado></FeCabResp>` +
      `<FeDetResp><FEDetResponse><Concepto>2</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>${o.nro}</CbteDesde><CbteHasta>${o.nro}</CbteHasta><Resultado>${o.resultado}</Resultado>` +
      `${o.cae ? `<CAE>${o.cae}</CAE><CAEFchVto>${o.due ?? '20250625'}</CAEFchVto>` : ''}${obs}</FEDetResponse></FeDetResp>` +
      `${msgs('Errors', 'Err', o.errors ?? [])}</FECAESolicitarResult></FECAESolicitarResponse>`,
  );
}

export function consultResponse(o: { cae: string; total: string; docTipo: number; docNro: string; nro: number }): string {
  return soap(
    `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><ResultGet>` +
      `<Concepto>2</Concepto><DocTipo>${o.docTipo}</DocTipo><DocNro>${o.docNro}</DocNro><CbteDesde>${o.nro}</CbteDesde><CbteHasta>${o.nro}</CbteHasta>` +
      `<CbteFch>20250615</CbteFch><ImpTotal>${o.total}</ImpTotal><Resultado>A</Resultado><CodAutorizacion>${o.cae}</CodAutorizacion><FchVto>20250625</FchVto>` +
      `</ResultGet></FECompConsultarResult></FECompConsultarResponse>`,
  );
}

export const notFoundConsult = () =>
  soap(
    `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>`,
  );

export interface MockCall {
  op: string;
  body: string;
}

/** A scripted ARCA: WSAA + WSFEv1 behind one `fetch`. Records every call. */
export function makeArcaMock() {
  const calls: MockCall[] = [];
  const state = {
    last: 100,
    cae: 70000000000001,
    /** Used once, in order, by FECAESolicitar. `lost` = ARCA registers the invoice but the answer never arrives. */
    plan: [] as ('ok' | 'reject' | 'lost' | 'unprocessed')[],
    registered: new Map<number, { total: string; docTipo: number; docNro: string; cae: string }>(),
    dummyStatus: 'OK',
  };

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    const action = String((init?.headers as Record<string, string> | undefined)?.soapaction ?? '');
    const op = url.includes('LoginCms') ? 'loginCms' : action.split('/').pop()!;
    calls.push({ op, body });
    const ok = (xml: string) => new Response(xml, { status: 200, headers: { 'content-type': 'text/xml' } });
    const field = (name: string) => new RegExp(`<ar:${name}>([^<]*)</ar:${name}>`).exec(body)?.[1] ?? '';

    switch (op) {
      case 'loginCms':
        return ok(loginResponse());
      case 'FEDummy':
        return ok(dummyResponse(state.dummyStatus));
      case 'FECompUltimoAutorizado':
        return ok(lastResponse(3, Number(field('CbteTipo')), state.last));
      case 'FECompConsultar': {
        const nro = Number(field('CbteNro'));
        const rec = state.registered.get(nro);
        return ok(rec ? consultResponse({ ...rec, nro }) : notFoundConsult());
      }
      case 'FECAESolicitar': {
        const mode = state.plan.shift() ?? 'ok';
        const nro = Number(field('CbteDesde'));
        const tipo = Number(field('CbteTipo'));
        if (mode === 'reject') {
          return ok(authorizeResponse({ resultado: 'R', nro, tipo, obs: [{ code: 10016, msg: 'El campo DocNro debe ser informado' }] }));
        }
        if (mode === 'unprocessed') throw new Error('connect ETIMEDOUT');
        const cae = String(state.cae++);
        state.last = nro;
        state.registered.set(nro, { total: field('ImpTotal'), docTipo: Number(field('DocTipo')), docNro: field('DocNro'), cae });
        if (mode === 'lost') throw new Error('socket hang up');
        return ok(authorizeResponse({ resultado: 'A', nro, cae, tipo }));
      }
      default:
        throw new Error(`unexpected ARCA call ${op} ${url}`);
    }
  }) as typeof fetch;

  return { fetch: fetchFn, calls, state, count: (op: string) => calls.filter((c) => c.op === op).length };
}
