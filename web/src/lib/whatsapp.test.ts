import { describe, expect, it } from 'vitest';
import { debtReminderText, normalizePhone, whatsappLink } from './whatsapp';

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
