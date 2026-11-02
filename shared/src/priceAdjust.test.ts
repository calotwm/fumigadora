import { describe, expect, it } from 'vitest';
import { adjustPrice, percentToBasisPoints } from './index.js';

describe('percentToBasisPoints', () => {
  it('converts percentages with up to two decimals without float drift', () => {
    expect(percentToBasisPoints(3.2)).toBe(320);
    expect(percentToBasisPoints(10)).toBe(1000);
    expect(percentToBasisPoints(2.75)).toBe(275);
    expect(percentToBasisPoints(0.07)).toBe(7);
  });

  it('rejects more than two decimals', () => {
    expect(() => percentToBasisPoints(3.255)).toThrow();
  });
});

describe('adjustPrice', () => {
  it('raises to the cent with round-half-up', () => {
    expect(adjustPrice(100_000_00, 1000)).toBe(110_000_00);
    expect(adjustPrice(12_345, 320)).toBe(12_740); // 12740.04
    expect(adjustPrice(50, 100)).toBe(51); // 50.5 -> 51 (half up)
    expect(adjustPrice(49, 100)).toBe(49); // 49.49 -> 49
  });

  it('rounds to $100 and to $1.000 half up', () => {
    // 45.450 * 1.10 = 49.995 -> $50.000 at $100 and at $1.000.
    expect(adjustPrice(45_450_00, 1000, '100')).toBe(50_000_00);
    // 12.345 * 1.10 = 13.579,50 -> $13.600 / $14.000.
    expect(adjustPrice(12_345_00, 1000, '100')).toBe(13_600_00);
    expect(adjustPrice(12_345_00, 1000, '1000')).toBe(14_000_00);
    // Exactly half a step goes up: 13.550 -> 13.600; 13.500 -> 14.000.
    expect(adjustPrice(13_550_00, 0, '100')).toBe(13_600_00);
    expect(adjustPrice(13_500_00, 0, '1000')).toBe(14_000_00);
    expect(adjustPrice(13_549_99, 0, '100')).toBe(13_500_00);
  });

  it('keeps zero at zero and handles very large amounts exactly', () => {
    expect(adjustPrice(0, 1000, '1000')).toBe(0);
    expect(adjustPrice(1e13, 1000)).toBe(1.1e13);
  });

  it('rejects invalid input', () => {
    expect(() => adjustPrice(-1, 100)).toThrow();
    expect(() => adjustPrice(1.5, 100)).toThrow();
    expect(() => adjustPrice(100, 1.5)).toThrow();
  });
});
