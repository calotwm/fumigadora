import { describe, expect, it } from 'vitest';
import {
  ArcaMappingError,
  formatArcaNumber,
  formatCuit,
  isValidCuit,
  mapInvoiceToArca,
  maskCuit,
  splitVat21,
  type ArcaMappingInput,
} from './arca.js';

describe('CUIT', () => {
  it('validates the check digit', () => {
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('20-12345678-6')).toBe(true);
    expect(isValidCuit('33693450239')).toBe(true); // ARCA's own CUIT (WSAA manual)
    expect(isValidCuit('20123456787')).toBe(false);
    expect(isValidCuit('2012345678')).toBe(false);
    expect(isValidCuit('abc')).toBe(false);
    expect(isValidCuit('')).toBe(false);
  });

  it('formats and masks', () => {
    expect(formatCuit('20123456786')).toBe('20-12345678-6');
    expect(maskCuit('20123456786')).toBe('20-****5678-6');
  });
});

describe('splitVat21', () => {
  it('splits total in cents without losing a cent', () => {
    expect(splitVat21(12100)).toEqual({ netCents: 10000, vatCents: 2100 });
    expect(splitVat21(10000)).toEqual({ netCents: 8264, vatCents: 1736 }); // 82.6446 -> 82.64
    expect(splitVat21(1)).toEqual({ netCents: 1, vatCents: 0 });
    for (const t of [1, 99, 12345, 99999, 1234567]) {
      const { netCents, vatCents } = splitVat21(t);
      expect(netCents + vatCents).toBe(t);
    }
  });
});

const base: ArcaMappingInput = {
  issuerCondition: 'monotributo',
  ptoVta: 3,
  cbteNro: 124,
  today: '2025-06-15',
  invoice: { amountCents: 12100, issuedOn: '2025-06-15', dueOn: '2025-06-25', periodMonth: null },
  client: { taxDocType: 'cuit', taxDocNumber: '20-12345678-6', ivaCondition: 'responsable_inscripto' },
};

describe('mapInvoiceToArca', () => {
  it('monotributo issuer -> Factura C without VAT breakdown', () => {
    const r = mapInvoiceToArca(base);
    expect(r.cbteTipo).toBe(11);
    expect(r.impNetoCents).toBe(12100);
    expect(r.impIvaCents).toBe(0);
    expect(r.iva).toEqual([]);
    expect(r.impTotConcCents).toBe(0);
    expect(r.impOpExCents).toBe(0);
    expect(r.docTipo).toBe(80);
    expect(r.docNro).toBe('20123456786');
    expect(r.condicionIvaReceptorId).toBe(1);
    expect(r.concepto).toBe(2);
    expect(r.fchServDesde).toBe('2025-06-15');
    expect(r.fchVtoPago).toBe('2025-06-25');
  });

  it('RI issuer + RI receptor with CUIT -> Factura A with 21%', () => {
    const r = mapInvoiceToArca({ ...base, issuerCondition: 'responsable_inscripto' });
    expect(r.cbteTipo).toBe(1);
    expect(r.impNetoCents).toBe(10000);
    expect(r.impIvaCents).toBe(2100);
    expect(r.iva).toEqual([{ id: 5, baseImpCents: 10000, importeCents: 2100 }]);
    expect(r.impTotalCents).toBe(r.impNetoCents + r.impIvaCents);
  });

  it('RI issuer + RI receptor without CUIT cannot be an A', () => {
    expect(() =>
      mapInvoiceToArca({
        ...base,
        issuerCondition: 'responsable_inscripto',
        client: { taxDocType: 'none', taxDocNumber: null, ivaCondition: 'responsable_inscripto' },
      }),
    ).toThrow(ArcaMappingError);
  });

  it('RI issuer + consumidor final without data -> Factura B with doc 99/0', () => {
    const r = mapInvoiceToArca({
      ...base,
      issuerCondition: 'responsable_inscripto',
      client: { taxDocType: 'none', taxDocNumber: null, ivaCondition: 'consumidor_final' },
    });
    expect(r.cbteTipo).toBe(6);
    expect(r.docTipo).toBe(99);
    expect(r.docNro).toBe('0');
    expect(r.condicionIvaReceptorId).toBe(5);
    expect(r.iva).toHaveLength(1);
  });

  it('DNI receptor uses doc type 96', () => {
    const r = mapInvoiceToArca({
      ...base,
      client: { taxDocType: 'dni', taxDocNumber: '30.123.456', ivaCondition: 'consumidor_final' },
    });
    expect(r.docTipo).toBe(96);
    expect(r.docNro).toBe('30123456');
  });

  it('rejects an invalid CUIT', () => {
    expect(() =>
      mapInvoiceToArca({ ...base, client: { taxDocType: 'cuit', taxDocNumber: '20123456787', ivaCondition: 'exento' } }),
    ).toThrow('CUIT');
  });

  it('monthly fee invoices cover the whole month', () => {
    const r = mapInvoiceToArca({ ...base, invoice: { ...base.invoice, periodMonth: '2025-06' } });
    expect(r.fchServDesde).toBe('2025-06-01');
    expect(r.fchServHasta).toBe('2025-06-30');
  });

  it('uses today as invoice date when the issue date is outside the 10 day window', () => {
    const r = mapInvoiceToArca({ ...base, invoice: { ...base.invoice, issuedOn: '2025-05-01', dueOn: '2025-05-11' } });
    expect(r.cbteFch).toBe('2025-06-15');
    expect(r.fchVtoPago).toBe('2025-06-15'); // never before the invoice date
    expect(r.fchServDesde).toBe('2025-05-01');
  });
});

describe('formatArcaNumber', () => {
  it('pads PtoVta and number', () => {
    expect(formatArcaNumber(3, 123)).toBe('0003-00000123');
  });
});
