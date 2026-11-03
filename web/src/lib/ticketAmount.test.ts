import { describe, expect, it } from 'vitest';
import { ticketTotalCents } from './ticketAmount';

describe('ticketTotalCents', () => {
  it('reads the TOTAL line of a fuel ticket, ignoring liters and price per liter', () => {
    const text = [
      'YPF ESTACION DE SERVICIO',
      'NAFTA SUPER',
      'LITROS 35,250',
      'P.UNIT 1.276,500',
      'SUBTOTAL $ 44.996,63',
      'TOTAL $ 44.996,63',
      'EFECTIVO $ 45.000,00',
    ].join('\n');
    expect(ticketTotalCents(text)).toBe(4_499_663);
  });

  it('accepts amounts without thousands separator and OCR spacing', () => {
    expect(ticketTotalCents('Importe Total:  $32500,00')).toBe(3_250_000);
    expect(ticketTotalCents('TOTAL 28 450,50')).toBe(2_845_050);
    expect(ticketTotalCents('TOTAL $ 18.000')).toBe(1_800_000);
  });

  it('falls back to the largest amount with cents when there is no total line', () => {
    expect(ticketTotalCents('NAFTA 12.500,00\nLITROS 9,800\nVUELTO 500,00')).toBe(1_250_000);
  });

  it('returns null when it finds no amount', () => {
    expect(ticketTotalCents('')).toBeNull();
    expect(ticketTotalCents('GRACIAS POR SU COMPRA\nLITROS 35,250')).toBeNull();
  });
});
