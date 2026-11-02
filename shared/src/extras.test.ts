import { describe, expect, it } from 'vitest';
import { extraUnitPriceCents } from './extras.js';

describe('extraUnitPriceCents', () => {
  it('is 30% of the service price, rounded to the cent', () => {
    expect(extraUnitPriceCents(50_000_00, 4_500_00)).toBe(15_000_00);
    expect(extraUnitPriceCents(333, 100)).toBe(100); // 99.9 -> 100
  });

  it('keeps the catalog price when the service has no price', () => {
    expect(extraUnitPriceCents(0, 4_500_00)).toBe(4_500_00);
  });
});
