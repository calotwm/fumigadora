import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapInvoiceToArca } from '@fumigadora/shared';
import { buildTra, parseLoginCmsResponse, signTra } from '../arca/wsaa.js';
import {
  buildAuthorizeRequest,
  parseAuthorizeResponse,
  parseConsultResponse,
  parseDummyResponse,
  parseLastAuthorizedResponse,
} from '../arca/wsfe.js';
import { ArcaError } from '../arca/xml.js';
import { flushAutoEmit } from '../arca/service.js';
import { loadArcaConfig } from '../config.js';
import {
  arcaConfigFor,
  arcaEnv,
  authorizeResponse,
  consultResponse,
  dummyResponse,
  lastResponse,
  loginResponse,
  makeArcaMock,
  testCertificate,
} from './arcaMock.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('ARCA config', () => {
  it('is inactive without variables and lists what is missing', () => {
    const c = loadArcaConfig({});
    expect(c.configured).toBe(false);
    expect(c.missing).toEqual(['ARCA_ENV', 'ARCA_CUIT', 'ARCA_CERT', 'ARCA_KEY', 'ARCA_PTO_VTA', 'ARCA_TAX_CONDITION']);
  });

  it('accepts escaped-newline and base64 PEM values', () => {
    const c = arcaConfigFor();
    expect(c.configured).toBe(true);
    expect(c.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(c.cert).toContain('\n');
    expect(c.key).toContain('PRIVATE KEY');
    expect(c.cuit).toBe('20123456786');
  });

  it('treats invalid values as missing', () => {
    const c = arcaConfigFor({ ARCA_CUIT: '20123456787', ARCA_ENV: 'prod', ARCA_PTO_VTA: 'x' });
    expect(c.configured).toBe(false);
    expect(c.missing).toEqual(['ARCA_ENV', 'ARCA_CUIT', 'ARCA_PTO_VTA']);
  });
});

describe('WSAA', () => {
  it('builds a TRA for the wsfe service with a valid window', () => {
    const now = new Date('2025-06-15T15:00:00Z'); // 12:00 in Argentina
    const tra = buildTra(now);
    expect(tra).toContain('<service>wsfe</service>');
    expect(tra).toContain('<generationTime>2025-06-15T11:50:00.000-03:00</generationTime>');
    expect(tra).toContain('<expirationTime>2025-06-15T12:10:00.000-03:00</expirationTime>');
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`);
  });

  it('signs the TRA as CMS (PKCS#7 SignedData) with the certificate attached', () => {
    const { certPem, keyPem, cert } = testCertificate();
    const tra = buildTra(new Date());
    const b64 = signTra(tra, certPem, keyPem);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(b64))) as forge.pkcs7.PkcsSignedData;
    expect((p7 as unknown as { type: string }).type).toBe(forge.pki.oids.signedData);
    expect(p7.certificates).toHaveLength(1);
    expect(forge.pki.certificateToPem(p7.certificates[0]!)).toBe(forge.pki.certificateToPem(cert));
    // Content is attached (not detached): the TRA travels inside the CMS.
    expect(forge.util.decode64(b64)).toContain('<service>wsfe</service>');
  });

  it('rejects a malformed key without leaking it', () => {
    expect(() => signTra('<a/>', 'nope', 'secret-key-material')).toThrowError(ArcaError);
    try {
      signTra('<a/>', 'nope', 'secret-key-material');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-key-material');
    }
  });

  it('parses the login answer and the SOAP fault', () => {
    const t = parseLoginCmsResponse(loginResponse(new Date('2025-06-16T00:00:00Z')));
    expect(t).toMatchObject({ token: 'TOKEN-ABC', sign: 'SIGN-XYZ' });
    expect(t.expiresAt.toISOString()).toBe('2025-06-16T00:00:00.000Z');
    const fault =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>';
    expect(() => parseLoginCmsResponse(fault)).toThrow('El CEE ya posee un TA valido');
  });
});

describe('WSFEv1 XML', () => {
  const auth = { token: 'T', sign: 'S', cuit: '20123456786' };
  const baseInput = {
    issuerCondition: 'responsable_inscripto' as const,
    ptoVta: 3,
    cbteNro: 124,
    today: '2025-06-15',
    invoice: { amountCents: 12100, issuedOn: '2025-06-15', dueOn: '2025-06-25', periodMonth: null },
    client: { taxDocType: 'cuit' as const, taxDocNumber: '33693450239', ivaCondition: 'responsable_inscripto' as const },
  };

  it('builds the FECAESolicitar request for a Factura A', () => {
    const xml = buildAuthorizeRequest(auth, mapInvoiceToArca(baseInput));
    expect(xml).toContain('<ar:Cuit>20123456786</ar:Cuit>');
    expect(xml).toContain('<ar:CbteTipo>1</ar:CbteTipo>');
    expect(xml).toContain('<ar:Concepto>2</ar:Concepto>');
    expect(xml).toContain('<ar:CbteDesde>124</ar:CbteDesde>');
    expect(xml).toContain('<ar:CbteFch>20250615</ar:CbteFch>');
    expect(xml).toContain('<ar:ImpTotal>121.00</ar:ImpTotal>');
    expect(xml).toContain('<ar:ImpNeto>100.00</ar:ImpNeto>');
    expect(xml).toContain('<ar:ImpIVA>21.00</ar:ImpIVA>');
    expect(xml).toContain('<ar:FchVtoPago>20250625</ar:FchVtoPago>');
    expect(xml).toContain('<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>');
    expect(xml).toContain('<ar:CondicionIVAReceptorId>1</ar:CondicionIVAReceptorId>');
    expect(xml).toContain('<ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>100.00</ar:BaseImp><ar:Importe>21.00</ar:Importe></ar:AlicIva>');
  });

  it('omits the Iva array for a Factura C', () => {
    const xml = buildAuthorizeRequest(auth, mapInvoiceToArca({ ...baseInput, issuerCondition: 'monotributo' }));
    expect(xml).toContain('<ar:CbteTipo>11</ar:CbteTipo>');
    expect(xml).not.toContain('<ar:Iva>');
    expect(xml).toContain('<ar:ImpIVA>0.00</ar:ImpIVA>');
    expect(xml).toContain('<ar:ImpNeto>121.00</ar:ImpNeto>');
  });

  it('parses an authorized answer with CAE and observations', () => {
    const r = parseAuthorizeResponse(authorizeResponse({ resultado: 'A', nro: 124, cae: '70123456789012', due: '20250625', obs: [{ code: 10063, msg: 'Aviso' }] }));
    expect(r).toMatchObject({ resultado: 'A', cae: '70123456789012', caeDueOn: '2025-06-25', cbteNro: 124 });
    expect(r.observations).toEqual([{ code: 10063, msg: 'Aviso' }]);
    expect(r.errors).toEqual([]);
  });

  it('parses a rejection with observations and request errors', () => {
    const r = parseAuthorizeResponse(
      authorizeResponse({
        resultado: 'R',
        nro: 124,
        obs: [
          { code: 10016, msg: 'Falta DocNro' },
          { code: 10246, msg: 'Falta condición IVA receptor' },
        ],
        errors: [{ code: 600, msg: 'ValidacionDeToken: Token inválido' }],
      }),
    );
    expect(r.resultado).toBe('R');
    expect(r.cae).toBeNull();
    expect(r.observations.map((o) => o.code)).toEqual([10016, 10246]);
    expect(r.errors).toEqual([{ code: 600, msg: 'ValidacionDeToken: Token inválido' }]);
  });

  it('never treats an answer without CAE as approved', () => {
    const xml = authorizeResponse({ resultado: 'A', nro: 5 });
    expect(parseAuthorizeResponse(xml).resultado).toBe('R');
  });

  it('parses dummy, last authorized and consult answers', () => {
    expect(parseDummyResponse(dummyResponse())).toEqual({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' });
    expect(parseLastAuthorizedResponse(lastResponse(3, 11, 77)).lastNumber).toBe(77);
    const c = parseConsultResponse(consultResponse({ cae: '7012', total: '121.00', docTipo: 80, docNro: '33693450239', nro: 5 }));
    expect(c).toMatchObject({ found: true, cae: '7012', totalCents: 12100, docTipo: 80, docNro: '33693450239', caeDueOn: '2025-06-25' });
  });
});

// ---------- API ----------

async function setup(env: Record<string, string | undefined> | null, mock = makeArcaMock()) {
  const arca = env === null ? loadArcaConfig({}) : arcaConfigFor(env);
  const t = await makeTestApp('2025-06-15', undefined, { config: { arca }, fetch: mock.fetch });
  return { t, mock };
}

async function newClient(t: TestApp, extra: Record<string, unknown> = {}) {
  return (await t.post('/api/clients', { name: 'Cliente ARCA', ...extra })).body as { id: number };
}

async function newInvoice(t: TestApp, clientId: number, amountCents = 12100) {
  return (await t.post('/api/invoices', { clientId, amountCents, description: 'Fumigación' })).body as { id: number };
}

describe('ARCA status and check', () => {
  let t: TestApp;
  afterEach(async () => t?.close());

  it('reports not configured without env (nothing secret returned)', async () => {
    ({ t } = await setup(null));
    const r = await t.get('/api/arca/status');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      configured: false,
      env: null,
      cuit: null,
      ptoVta: null,
      taxCondition: null,
      missing: ['ARCA_ENV', 'ARCA_CUIT', 'ARCA_CERT', 'ARCA_KEY', 'ARCA_PTO_VTA', 'ARCA_TAX_CONDITION'],
    });
    expect((await t.post('/api/arca/check')).status).toBe(409);
  });

  it('reports the masked configuration and never the key material', async () => {
    ({ t } = await setup({}));
    const r = await t.get('/api/arca/status');
    expect(r.body).toEqual({ configured: true, env: 'homologacion', cuit: '20-****5678-6', ptoVta: 3, taxCondition: 'monotributo', missing: [] });
    expect(JSON.stringify(r.body)).not.toMatch(/BEGIN|PRIVATE|TOKEN/);
  });

  it('check runs dummy, login and last authorized', async () => {
    let mock;
    ({ t, mock } = await setup({}));
    const r = await t.post('/api/arca/check');
    expect(r.body.ok).toBe(true);
    expect(r.body.steps.map((s: { name: string; ok: boolean }) => [s.name, s.ok])).toEqual([
      ['dummy', true],
      ['login', true],
      ['last_authorized', true],
    ]);
    expect(mock.calls.map((c) => c.op)).toEqual(['FEDummy', 'loginCms', 'FECompUltimoAutorizado']);
    expect(JSON.stringify(r.body)).not.toContain('TOKEN-ABC');
  });

  it('check reports the failing step when ARCA services are down', async () => {
    const mock = makeArcaMock();
    mock.state.dummyStatus = 'DOWN';
    ({ t } = await setup({}, mock));
    const r = await t.post('/api/arca/check');
    expect(r.body.ok).toBe(false);
    expect(r.body.steps).toHaveLength(1);
    expect(r.body.steps[0]).toMatchObject({ name: 'dummy', ok: false });
  });
});

describe('client fiscal data', () => {
  let t: TestApp;
  beforeEach(async () => ({ t } = await setup(null)));
  afterEach(async () => t.close());

  it('defaults to consumidor final without document', async () => {
    const c = (await t.post('/api/clients', { name: 'Ana' })).body;
    expect(c).toMatchObject({ taxDocType: 'none', taxDocNumber: null, ivaCondition: 'consumidor_final', legalName: null });
  });

  it('validates the CUIT checksum and stores digits only', async () => {
    const bad = await t.post('/api/clients', { name: 'X', taxDocType: 'cuit', taxDocNumber: '20-12345678-7' });
    expect(bad.status).toBe(400);
    const ok = await t.post('/api/clients', {
      name: 'Y',
      taxDocType: 'cuit',
      taxDocNumber: '20-12345678-6',
      ivaCondition: 'responsable_inscripto',
      legalName: 'Y S.A.',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ taxDocType: 'cuit', taxDocNumber: '20123456786', ivaCondition: 'responsable_inscripto', legalName: 'Y S.A.' });
    const upd = await t.patch(`/api/clients/${ok.body.id}`, { taxDocType: 'none' });
    expect(upd.body).toMatchObject({ taxDocType: 'none', taxDocNumber: null });
    expect((await t.patch(`/api/clients/${ok.body.id}`, { taxDocType: 'dni', taxDocNumber: '12' })).status).toBe(400);
  });
});

describe('emit invoice in ARCA', () => {
  let t: TestApp;
  let mock: ReturnType<typeof makeArcaMock>;
  afterEach(async () => t?.close());

  it('does nothing and answers 409 while ARCA is not configured; invoicing is unchanged', async () => {
    ({ t } = await setup(null));
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    const got = await t.get(`/api/invoices/${inv.id}`);
    expect(got.body).toMatchObject({ arcaStatus: 'not_sent', cae: null, cbteNumber: null, arcaObservations: null });
    const emit = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(emit.status).toBe(409);
    expect(emit.body.error.code).toBe('arca_not_configured');
    const pay = await t.post('/api/payments', { clientId: c.id, amountCents: 12100, method: 'cash' });
    expect(pay.status).toBe(201);
    expect((await t.get(`/api/invoices/${inv.id}`)).body.status).toBe('paid');
  });

  it('authorizes a Factura C (monotributo) and stores CAE, number and due date', async () => {
    ({ t, mock } = await setup({ ARCA_TAX_CONDITION: 'monotributo' }));
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    const r = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      arcaStatus: 'authorized',
      cbteType: 11,
      ptoVta: 3,
      cbteNumber: 101,
      cae: '70000000000001',
      caeDueOn: '2025-06-25',
      number: '2025-0001', // internal number untouched
    });
    expect(mock.count('FECAESolicitar')).toBe(1);
    const body = mock.calls.find((x) => x.op === 'FECAESolicitar')!.body;
    expect(body).not.toContain('<ar:Iva>');
    expect(body).toContain('<ar:DocTipo>99</ar:DocTipo><ar:DocNro>0</ar:DocNro>');
    expect((await t.get(`/api/invoices/${inv.id}`)).body.arcaStatus).toBe('authorized');
    // The ticket is cached in the DB: a second emission does not log in again.
    const inv2 = await newInvoice(t, c.id, 5000);
    const r2 = await t.post(`/api/invoices/${inv2.id}/arca`);
    expect(r2.body).toMatchObject({ arcaStatus: 'authorized', cbteNumber: 102 });
    expect(mock.count('loginCms')).toBe(1);
  });

  it('authorizes a Factura A with IVA 21% for a Responsable Inscripto issuer', async () => {
    ({ t, mock } = await setup({ ARCA_TAX_CONDITION: 'responsable_inscripto' }));
    const c = await newClient(t, { taxDocType: 'cuit', taxDocNumber: '33693450239', ivaCondition: 'responsable_inscripto' });
    const inv = await newInvoice(t, c.id, 12100);
    const r = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(r.body).toMatchObject({ arcaStatus: 'authorized', cbteType: 1 });
    const body = mock.calls.find((x) => x.op === 'FECAESolicitar')!.body;
    expect(body).toContain('<ar:ImpNeto>100.00</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx>');
    expect(body).toContain('<ar:AlicIva><ar:Id>5</ar:Id>');
  });

  it('refuses a Factura A for a client without a valid CUIT (400, nothing sent)', async () => {
    ({ t, mock } = await setup({ ARCA_TAX_CONDITION: 'responsable_inscripto' }));
    const c = await newClient(t, { ivaCondition: 'responsable_inscripto' });
    const inv = await newInvoice(t, c.id);
    const r = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('arca_invalid_data');
    expect(mock.count('FECAESolicitar')).toBe(0);
  });

  it('an authorized invoice cannot be emitted again (409)', async () => {
    ({ t, mock } = await setup({}));
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    expect((await t.post(`/api/invoices/${inv.id}/arca`)).status).toBe(200);
    const again = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_authorized');
    expect(mock.count('FECAESolicitar')).toBe(1);
  });

  it('stores the observations of a rejection and allows emitting again after fixing the data', async () => {
    ({ t, mock } = await setup({}));
    mock.state.plan.push('reject');
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    const r = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(r.status).toBe(200);
    expect(r.body.arcaStatus).toBe('rejected');
    expect(r.body.cae).toBeNull();
    expect(r.body.arcaObservations.observations).toEqual([{ code: 10016, msg: 'El campo DocNro debe ser informado' }]);
    const retry = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(retry.body).toMatchObject({ arcaStatus: 'authorized', cbteNumber: 101 });
  });

  it('network error: marks error, and a retry sends the same number when ARCA never saw the request', async () => {
    ({ t, mock } = await setup({}));
    mock.state.plan.push('unprocessed');
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    const r = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(r.body.arcaStatus).toBe('error');
    expect(r.body.arcaObservations.message).toContain('No se pudo conectar con ARCA');
    expect(r.body.arcaAttemptedAt).toBeTruthy();
    const retry = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(retry.body).toMatchObject({ arcaStatus: 'authorized', cbteNumber: 101 });
    expect(mock.count('FECompConsultar')).toBe(0);
  });

  it('lost answer: the retry reconciles with ARCA instead of creating a duplicate', async () => {
    ({ t, mock } = await setup({}));
    mock.state.plan.push('lost'); // ARCA authorized 101 but we never got the answer
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    const first = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(first.body.arcaStatus).toBe('error');
    expect(mock.state.last).toBe(101);

    const retry = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(retry.body).toMatchObject({ arcaStatus: 'authorized', cbteNumber: 101, cae: '70000000000001', cbteType: 11 });
    expect(mock.count('FECAESolicitar')).toBe(1); // no second authorization request
    expect(mock.count('FECompConsultar')).toBe(1);
  });

  it('reconciliation does not adopt a comprobante that belongs to another invoice', async () => {
    ({ t, mock } = await setup({}));
    mock.state.plan.push('unprocessed');
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id, 12100);
    await t.post(`/api/invoices/${inv.id}/arca`); // error, attempted 101
    // Someone else (another system) used number 101 for a different amount.
    mock.state.last = 101;
    mock.state.registered.set(101, { total: '999.00', docTipo: 99, docNro: '0', cae: '555' });
    const retry = await t.post(`/api/invoices/${inv.id}/arca`);
    expect(retry.body).toMatchObject({ arcaStatus: 'authorized', cbteNumber: 102 });
    expect(retry.body.cae).not.toBe('555');
  });

  it('serializes concurrent emissions so numbers stay sequential', async () => {
    ({ t, mock } = await setup({}));
    const c = await newClient(t);
    const ids = [(await newInvoice(t, c.id, 1000)).id, (await newInvoice(t, c.id, 2000)).id, (await newInvoice(t, c.id, 3000)).id];
    const results = await Promise.all(ids.map((id) => t.post(`/api/invoices/${id}/arca`)));
    expect(results.map((r) => r.body.cbteNumber).sort()).toEqual([101, 102, 103]);
  });
});

describe('automatic emission', () => {
  let t: TestApp;
  let mock: ReturnType<typeof makeArcaMock>;
  afterEach(async () => t?.close());

  it('is off by default', async () => {
    ({ t, mock } = await setup({}));
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    await flushAutoEmit();
    expect((await t.get(`/api/invoices/${inv.id}`)).body.arcaStatus).toBe('not_sent');
    expect(mock.calls).toHaveLength(0);
  });

  it('emits invoices from manual creation, visit completion and the monthly batch once enabled', async () => {
    ({ t, mock } = await setup({}));
    expect((await t.call('PUT', '/api/settings', { arcaAutoEmit: true })).body.arcaAutoEmit).toBe(true);
    const c = await newClient(t, { monthlyFeeCents: 8000 });
    const manual = await newInvoice(t, c.id);

    const st = (await t.post('/api/service-types', { name: 'Fumigación', defaultPriceCents: 5000 })).body;
    const visit = (await t.post('/api/visits', { clientId: c.id, serviceTypeId: st.id, date: '2025-06-15' })).body;
    const done = await t.post(`/api/visits/${visit.id}/complete`, { createInvoice: true });
    expect(done.status).toBe(200);

    const batch = await t.post('/api/invoices/monthly-batch', { month: '2025-06', clientIds: [c.id] });
    expect(batch.status).toBe(201);
    await flushAutoEmit();

    for (const id of [manual.id, done.body.invoice.id, batch.body.created[0].id]) {
      const inv = (await t.get(`/api/invoices/${id}`)).body;
      expect(inv.arcaStatus).toBe('authorized');
    }
    expect(mock.count('FECAESolicitar')).toBe(3);
  });

  it('a failing emission never breaks invoice creation', async () => {
    const mock = makeArcaMock();
    mock.state.plan.push('unprocessed');
    ({ t } = await setup({}, mock));
    await t.call('PUT', '/api/settings', { arcaAutoEmit: true });
    const c = await newClient(t);
    const res = await t.post('/api/invoices', { clientId: c.id, amountCents: 5000 });
    expect(res.status).toBe(201);
    await flushAutoEmit();
    const inv = (await t.get(`/api/invoices/${res.body.id}`)).body;
    expect(inv.arcaStatus).toBe('error');
    expect(inv.status).toBe('pending');
  });

  it('ignores the setting while ARCA is not configured', async () => {
    ({ t } = await setup(null));
    await t.call('PUT', '/api/settings', { arcaAutoEmit: true });
    const c = await newClient(t);
    const inv = await newInvoice(t, c.id);
    await flushAutoEmit();
    expect((await t.get(`/api/invoices/${inv.id}`)).body.arcaStatus).toBe('not_sent');
  });
});

describe('env helper', () => {
  it('builds a complete env', () => {
    expect(arcaEnv().ARCA_PTO_VTA).toBe('3');
  });
});
