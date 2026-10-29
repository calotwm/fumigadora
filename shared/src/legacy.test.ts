import { describe, expect, it } from 'vitest';
import {
  mapLegacyAppointment,
  mapLegacyCertificate,
  mapLegacyClient,
  mapLegacyClientKind,
  mapLegacyContact,
  mapLegacyIvaCondition,
  mapLegacyPaymentMethod,
  mapLegacyTaxDoc,
  mapLegacyVisitStatus,
  normalizeServiceTypeName,
  legacyPesosToCents,
  splitLedger,
  utcToArgentina,
  type LegacyLedgerRow,
} from './legacy.js';

describe('legacyPesosToCents', () => {
  it('converts numbers, strings and float artifacts to integer cents', () => {
    expect(legacyPesosToCents(1500)).toBe(150000);
    expect(legacyPesosToCents(1234.56)).toBe(123456);
    expect(legacyPesosToCents(0.1 + 0.2)).toBe(30);
    expect(legacyPesosToCents(1234.5600000000002)).toBe(123456);
    expect(legacyPesosToCents(19.99)).toBe(1999);
    expect(legacyPesosToCents('250.5')).toBe(25050);
    expect(legacyPesosToCents('250,75')).toBe(25075);
    expect(legacyPesosToCents(-80.1)).toBe(-8010);
  });

  it('treats empty values as zero and rejects garbage', () => {
    expect(legacyPesosToCents(null)).toBe(0);
    expect(legacyPesosToCents(undefined)).toBe(0);
    expect(legacyPesosToCents('')).toBe(0);
    expect(Object.is(legacyPesosToCents(-0.001), 0)).toBe(true);
    expect(() => legacyPesosToCents('abc')).toThrow(RangeError);
  });
});

describe('utcToArgentina', () => {
  it('shifts UTC to UTC-3, crossing the day boundary', () => {
    expect(utcToArgentina('2024-03-10T15:30:00.000Z')).toEqual({ date: '2024-03-10', time: '12:30' });
    expect(utcToArgentina('2024-03-10T02:59:00.000Z')).toEqual({ date: '2024-03-09', time: '23:59' });
    expect(utcToArgentina('2024-03-10T03:00:00.000Z')).toEqual({ date: '2024-03-10', time: '00:00' });
    expect(utcToArgentina('2024-01-01T01:00:00.000Z')).toEqual({ date: '2023-12-31', time: '22:00' });
  });

  it('keeps date-only values and rejects invalid ones', () => {
    expect(utcToArgentina('2024-05-06')).toEqual({ date: '2024-05-06', time: '00:00' });
    expect(() => utcToArgentina('not a date')).toThrow(RangeError);
  });
});

describe('code mappings', () => {
  it('maps appointment statuses', () => {
    expect(mapLegacyVisitStatus(1)).toBe('scheduled');
    expect(mapLegacyVisitStatus(2)).toBe('done');
    expect(mapLegacyVisitStatus(3)).toBe('scheduled');
    expect(mapLegacyVisitStatus(4)).toBe('cancelled');
  });

  it('maps payment methods', () => {
    expect(mapLegacyPaymentMethod(1)).toBe('cash');
    expect(mapLegacyPaymentMethod(2)).toBe('transfer');
    expect(mapLegacyPaymentMethod(3)).toBe('check');
    expect(mapLegacyPaymentMethod(4)).toBe('mercadopago');
    expect(mapLegacyPaymentMethod(5)).toBe('transfer');
    expect(mapLegacyPaymentMethod(null)).toBe('other');
    expect(mapLegacyPaymentMethod(99)).toBe('other');
  });

  it('maps tax documents', () => {
    expect(mapLegacyTaxDoc(80, '30-12345678-5')).toEqual({ taxDocType: 'cuit', taxDocNumber: '30123456785' });
    expect(mapLegacyTaxDoc(86, '20123456786')).toEqual({ taxDocType: 'cuit', taxDocNumber: '20123456786' });
    expect(mapLegacyTaxDoc(96, '12.345.678')).toEqual({ taxDocType: 'dni', taxDocNumber: '12345678' });
    expect(mapLegacyTaxDoc(0, '')).toEqual({ taxDocType: 'none', taxDocNumber: null });
    expect(mapLegacyTaxDoc(80, null)).toEqual({ taxDocType: 'none', taxDocNumber: null });
    expect(mapLegacyTaxDoc(0, '123')).toEqual({ taxDocType: 'none', taxDocNumber: null });
  });

  it('maps IVA conditions, defaulting unset ones to consumidor final', () => {
    expect(mapLegacyIvaCondition(1)).toBe('responsable_inscripto');
    expect(mapLegacyIvaCondition(2)).toBe('exento');
    expect(mapLegacyIvaCondition(3)).toBe('monotributo');
    expect(mapLegacyIvaCondition(4)).toBe('consumidor_final');
    expect(mapLegacyIvaCondition(0)).toBe('consumidor_final');
    expect(mapLegacyIvaCondition(null)).toBe('consumidor_final');
  });

  it('detects buildings by the Consorcio prefix', () => {
    expect(mapLegacyClientKind('Consorcio Calle Falsa 123')).toBe('building');
    expect(mapLegacyClientKind('  consorcio de propietarios')).toBe('building');
    expect(mapLegacyClientKind('Consorcios SA')).toBe('business');
    expect(mapLegacyClientKind('Panadería Ejemplo')).toBe('business');
  });

  it('normalizes service type names', () => {
    expect(normalizeServiceTypeName('  Limpieza   de tanque ')).toBe('Limpieza de tanque');
    expect(normalizeServiceTypeName(null)).toBe('Servicio');
  });
});

describe('entity mappers', () => {
  it('maps a customer summary', () => {
    const draft = mapLegacyClient({
      id: 7,
      name: ' Consorcio Ejemplo 100 ',
      legalId: '30-00000000-1',
      legalIdType: 80,
      legalName: 'Consorcio Ejemplo SRL',
      taxConditionId: 2,
      address: 'Calle Falsa 100',
      city: 'Ciudad Uno',
      province: 'Provincia Uno',
      postalCode: null,
      latitude: '-34.6',
      longitude: '-58.4',
      comment: '',
      balance: 0,
    });
    expect(draft).toMatchObject({
      legacyId: 7,
      name: 'Consorcio Ejemplo 100',
      kind: 'building',
      area: 'Ciudad Uno',
      city: 'Ciudad Uno',
      province: 'Provincia Uno',
      postalCode: null,
      latitude: -34.6,
      longitude: -58.4,
      notes: null,
      taxDocType: 'cuit',
      taxDocNumber: '30000000001',
      ivaCondition: 'exento',
      legalName: 'Consorcio Ejemplo SRL',
    });
  });

  it('drops empty or impossible coordinates', () => {
    const base = { id: 1, name: 'A', balance: 0 };
    expect(mapLegacyClient({ ...base, latitude: '', longitude: '0' })).toMatchObject({ latitude: null, longitude: null });
    expect(mapLegacyClient({ ...base, latitude: '95', longitude: 'x' })).toMatchObject({ latitude: null, longitude: null });
  });

  it('maps contact data by parameter', () => {
    const draft = mapLegacyContact({
      id: 3,
      name: 'Persona Uno',
      ContactData: [
        { param: 'PHON', data: '1100000000' },
        { param: 'WHAT', data: '1155555555' },
        { param: 'EMAI', data: 'uno@example.com' },
        { param: 'POSI', data: 'Administrador' },
        { param: 'DNIN', data: '123' },
        { param: null, data: 'free text' },
        { param: 'PHON', data: '' },
      ],
    });
    expect(draft).toEqual({
      legacyId: 3,
      name: 'Persona Uno',
      phone: '1100000000',
      whatsapp: '1155555555',
      email: 'uno@example.com',
      position: 'Administrador',
      notes: 'DNI: 123\nfree text',
    });
    expect(mapLegacyContact({ id: 4, name: 'Sin datos' }).notes).toBeNull();
  });

  it('maps appointments and skips the undated ones', () => {
    const base = { id: 10, statusId: 2, amount: 1500.5, AppointmentType: { name: ' Fumigación ' } };
    expect(mapLegacyAppointment({ ...base, dateStart: '2024-03-10T12:00:00.000Z' })).toEqual({
      legacyId: 10,
      date: '2024-03-10',
      time: '09:00',
      status: 'done',
      serviceTypeName: 'Fumigación',
      priceCents: 150050,
      completedAt: '2024-03-10T12:00:00.000Z',
    });
    const pending = mapLegacyAppointment({ ...base, statusId: 1, dateStart: '2024-03-10T01:00:00.000Z' });
    expect(pending).toMatchObject({ date: '2024-03-09', time: '22:00', status: 'scheduled', completedAt: null });
    expect(mapLegacyAppointment({ ...base, dateStart: null })).toBeNull();
  });

  it('maps certificates', () => {
    expect(
      mapLegacyCertificate({
        id: 5,
        description: ' Oblea ',
        date: '2024-03-10T03:00:00.000Z',
        dateExpiration: '2024-09-10T03:00:00.000Z',
        appointmentId: 10,
        File: { url: '/files/x.pdf' },
      }),
    ).toEqual({
      legacyId: 5,
      number: 'L-5',
      issuedOn: '2024-03-10',
      expiresOn: '2024-09-10',
      description: 'Oblea',
      legacyFileUrl: '/files/x.pdf',
      visitLegacyId: 10,
    });
    expect(mapLegacyCertificate({ id: 6, date: '2024-01-01T12:00:00.000Z', dateExpiration: '2024-02-01T12:00:00.000Z', File: null })).toMatchObject({
      description: null,
      legacyFileUrl: null,
      visitLegacyId: null,
    });
  });
});

describe('splitLedger', () => {
  const row = (over: Partial<LegacyLedgerRow> & { id: number }): LegacyLedgerRow => ({
    date: '2024-01-10T12:00:00.000Z',
    description: 'row',
    debit: 0,
    paymentMethodId: null,
    executed: false,
    currentAccount: 0,
    ...over,
  });

  it('splits charges and payments, skipping zero charges and turning negative ones into credits', () => {
    const rows: LegacyLedgerRow[] = [
      row({ id: 3, executed: true, debit: 500.25, currentAccount: -500.25, paymentMethodId: 2, date: '2024-02-01T12:00:00.000Z' }),
      row({ id: 1, currentAccount: 1000.1 + 0.2, description: 'Service' }),
      row({ id: 2, currentAccount: 0 }),
      row({ id: 4, currentAccount: -40, date: '2024-01-20T12:00:00.000Z' }),
      row({ id: 5, executed: true, debit: 0, currentAccount: 0 }),
      row({ id: 6, executed: true, debit: null, currentAccount: -75, paymentMethodId: 1, date: '2024-01-05T12:00:00.000Z' }),
    ];
    const { invoices, payments, report } = splitLedger(rows);

    expect(invoices).toEqual([
      { legacyId: 1, number: 'L-1', issuedOn: '2024-01-10', dueOn: '2024-01-10', amountCents: 100030, description: 'Service', periodMonth: '2024-01' },
    ]);
    expect(payments.map((p) => [p.legacyId, p.paidOn, p.amountCents, p.method, p.isCredit])).toEqual([
      [6, '2024-01-05', 7500, 'cash', false],
      [4, '2024-01-20', 4000, 'other', true],
      [3, '2024-02-01', 50025, 'transfer', false],
    ]);
    expect(report).toEqual({ charges: 1, payments: 2, zeroSkipped: 1, negativeCredits: 1, emptyPaymentsSkipped: 1 });
  });

  it('keeps the net balance: invoices minus payments equals the sum of the signed amounts', () => {
    const rows: LegacyLedgerRow[] = [
      row({ id: 1, currentAccount: 1200.37 }),
      row({ id: 2, currentAccount: 800.1 }),
      row({ id: 3, executed: true, debit: 1000.2, currentAccount: -1000.2 }),
      row({ id: 4, currentAccount: -50.05 }),
    ];
    const { invoices, payments } = splitLedger(rows);
    const net = invoices.reduce((s, i) => s + i.amountCents, 0) - payments.reduce((s, p) => s + p.amountCents, 0);
    const expected = rows.reduce((s, r) => s + legacyPesosToCents(r.currentAccount), 0);
    expect(net).toBe(expected);
  });
});
