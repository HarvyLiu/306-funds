import {describe, expect, it} from 'vitest';

import {formatTwd} from '../src/index.js';

describe('formatTwd', () => {
  it.each([
    [0, 'NT$0'],
    [50_676, 'NT$50,676'],
    [-100, '-NT$100'],
    [Number.MAX_SAFE_INTEGER, 'NT$9,007,199,254,740,991'],
  ] as const)('formats %s as a whole TWD amount', (amount, expected) => {
    const original = amount;

    expect(formatTwd(amount)).toBe(expected);
    expect(amount).toBe(original);
    expect(formatTwd(amount)).not.toContain('.');
  });

  it.each([1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a non-safe whole amount (%s)',
    (amount) => {
      expect(() => formatTwd(amount)).toThrow(RangeError);
    },
  );
});
