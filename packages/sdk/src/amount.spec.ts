import {
  I128_MAX,
  InvalidAmountError,
  addStroops,
  assertPositiveStroops,
  fromStroops,
  isAtLeast,
  multiplyStroops,
  toBigInt,
  toStroops,
} from './amount';

describe('amount', () => {
  it('scales display amounts by 10^7', () => {
    expect(toStroops('1')).toBe('10000000');
    expect(toStroops('10.5')).toBe('105000000');
    expect(toStroops('0.0000001')).toBe('1');
    expect(toStroops('0')).toBe('0');
  });

  it('converts decimals exactly, without floating-point drift', () => {
    expect(addStroops(toStroops('0.1'), toStroops('0.2'))).toBe(toStroops('0.3'));
  });

  it('keeps precision beyond the 2^53 safe-integer range', () => {
    const stroops = toStroops('9007199254.7407407');
    expect(stroops).toBe('90071992547407407');
    expect(String(Number(stroops))).not.toBe(stroops);
    expect(fromStroops(stroops)).toBe('9007199254.7407407');
  });

  it('rejects more than seven decimal places instead of truncating', () => {
    expect(() => toStroops('0.00000001')).toThrow(InvalidAmountError);
  });

  it('rejects negatives, blanks and non-numeric text', () => {
    for (const bad of ['-1', '', 'abc', '1.2.3', '1e7', '.5', '+1']) {
      expect(() => toStroops(bad)).toThrow(InvalidAmountError);
    }
  });

  it('rejects numbers so a float cannot be smuggled in', () => {
    expect(() => toStroops(10.5 as unknown as string)).toThrow(InvalidAmountError);
    expect(() => toBigInt(5 as unknown as string)).toThrow(InvalidAmountError);
  });

  it('rejects values outside the i128 range', () => {
    expect(() => toBigInt((I128_MAX + 1n).toString())).toThrow(InvalidAmountError);
    expect(toBigInt(I128_MAX.toString())).toBe(I128_MAX);
  });

  it('formats stroops for display', () => {
    expect(fromStroops('10000000')).toBe('1.0');
    expect(fromStroops('105000000')).toBe('10.5');
    expect(fromStroops('1')).toBe('0.0000001');
    expect(fromStroops('-5000000')).toBe('-0.5');
  });

  it('does stroop arithmetic on bigints', () => {
    expect(multiplyStroops('5000000', 2)).toBe('10000000');
    expect(isAtLeast('10', '9')).toBe(true);
    expect(isAtLeast('9', '10')).toBe(false);
  });

  it('requires stakes to be positive and normalises them', () => {
    expect(assertPositiveStroops('007')).toBe('7');
    expect(() => assertPositiveStroops('0')).toThrow(/greater than zero/);
    expect(() => assertPositiveStroops('-3')).toThrow(/greater than zero/);
  });
});
