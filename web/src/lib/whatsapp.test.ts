import { describe, expect, it } from 'vitest';
import {
  debtReminderText,
  ipcInterestFrom,
  normalizePhone,
  overdueDebtText,
  overdueInvoices,
  visitReminderText,
  whatsappLink,
} from './whatsapp';

const IPC_PARAGRAPH =
  'Le informamos que, si el saldo vencido no se regulariza antes del 25/06/2025, a partir de esa fecha comenzará a aplicarse sobre él un interés calculado según la variación del Índice de Precios al Consumidor (IPC) publicado por el INDEC.';

describe('overdueInvoices', () => {
  it('keeps unpaid, non-voided invoices due before today, oldest first, with their total', () => {
    const inv = (number: string, dueOn: string, balanceCents: number, voided = false) => ({ number, dueOn, balanceCents, voided });
    const result = overdueInvoices(
      [
        inv('2025-0003', '2025-06-10', 3_000_00),
        inv('2025-0001', '2025-05-01', 10_000_00),
        inv('2025-0004', '2025-06-15', 9_000_00), // due today: not overdue yet
        inv('2025-0002', '2025-05-20', 0), // paid
        inv('2025-0005', '2025-05-02', 7_000_00, true), // voided
      ],
      '2025-06-15',
    );
    expect(result.invoices.map((i) => i.number)).toEqual(['2025-0001', '2025-0003']);
    expect(result.totalCents).toBe(13_000_00);
  });
});

describe('overdueDebtText', () => {
  const invoices = [
    { number: '2025-0001', dueOn: '2025-05-01', balanceCents: 10_000_00 },
    { number: '2025-0003', dueOn: '2025-06-10', balanceCents: 3_000_00 },
  ];

  it('lists each overdue invoice with its due date and balance, and the total', () => {
    const text = overdueDebtText({ clientName: 'Plaza', invoices, totalCents: 13_000_00, interestFrom: null });
    expect(text).toBe(
      [
        'Hola Plaza, le escribimos de Plagamix. Le recordamos que, según nuestros registros, las siguientes facturas se encuentran vencidas y con saldo pendiente:',
        '',
        '• Factura 2025-0001, vencida el 01/05/2025: $ 10.000',
        '• Factura 2025-0003, vencida el 10/06/2025: $ 3.000',
        '',
        'Total adeudado: $ 13.000',
        '',
        'Le agradeceremos regularizar el pago a la brevedad. Si necesita los datos para realizar la transferencia o desea coordinar otra forma de pago, responda a este mensaje.',
        '',
        'Si ya realizó el pago, desestime este mensaje. ¡Muchas gracias!',
      ].join('\n'),
    );
    expect(text).not.toContain('IPC');
  });

  it('adds the IPC warning paragraph with the date when it is given', () => {
    const text = overdueDebtText({ clientName: 'Plaza', invoices, totalCents: 13_000_00, interestFrom: '2025-06-25' });
    expect(text).toContain(`\n\n${IPC_PARAGRAPH}\n\n`);
    // Between the payment request and the closing line, as in the email.
    expect(text.indexOf('a la brevedad')).toBeLessThan(text.indexOf(IPC_PARAGRAPH));
    expect(text.indexOf(IPC_PARAGRAPH)).toBeLessThan(text.indexOf('Si ya realizó el pago'));
  });
});

describe('ipcInterestFrom', () => {
  it('is today + the grace days when the warning is on', () => {
    expect(ipcInterestFrom({ ipcWarningEnabled: true, ipcWarningGraceDays: 10 }, '2025-06-15')).toBe('2025-06-25');
    expect(ipcInterestFrom({ ipcWarningEnabled: true, ipcWarningGraceDays: 20 }, '2025-06-15')).toBe('2025-07-05');
  });
  it('is null when the setting is off, missing or not a real true', () => {
    expect(ipcInterestFrom({ ipcWarningEnabled: false, ipcWarningGraceDays: 10 }, '2025-06-15')).toBeNull();
    expect(ipcInterestFrom({}, '2025-06-15')).toBeNull();
    expect(ipcInterestFrom({ ipcWarningEnabled: 'true' }, '2025-06-15')).toBeNull();
    expect(ipcInterestFrom(undefined, '2025-06-15')).toBeNull();
  });
  it('falls back to the default 10 grace days when the value is missing or invalid', () => {
    expect(ipcInterestFrom({ ipcWarningEnabled: true }, '2025-06-15')).toBe('2025-06-25');
    expect(ipcInterestFrom({ ipcWarningEnabled: true, ipcWarningGraceDays: 0 }, '2025-06-15')).toBe('2025-06-25');
  });
});

describe('visitReminderText (unchanged)', () => {
  it('names the service, date and time', () => {
    expect(visitReminderText('Plaza', 'Desinsectación', 'lunes 16 de junio', '10:00')).toBe(
      'Hola Plaza, le recordamos que el lunes 16 de junio a las 10:00 realizaremos el servicio de Desinsectación. Ante cualquier consulta, escribanos. ¡Muchas gracias!',
    );
  });
});

describe('normalizePhone', () => {
  it('strips punctuation, the trunk zero and adds the country code', () => {
    expect(normalizePhone('011 5555-1234')).toBe('541155551234');
  });
  it('keeps an existing country code', () => {
    expect(normalizePhone('+54 9 11 5555-1234')).toBe('5491155551234');
  });
  it('handles the 00 international prefix', () => {
    expect(normalizePhone('0054 9 351 555 1234')).toBe('5493515551234');
  });
  it('returns null without digits', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('sin telefono')).toBeNull();
  });
});

describe('whatsappLink', () => {
  it('encodes the reminder text with the formatted amount', () => {
    const link = whatsappLink('1155551234', debtReminderText('Plaza', 4000000));
    expect(link?.startsWith('https://wa.me/541155551234?text=')).toBe(true);
    expect(decodeURIComponent(link ?? '')).toContain('$ 40.000');
  });
  it('is null without a phone', () => {
    expect(whatsappLink(null)).toBeNull();
  });
});
