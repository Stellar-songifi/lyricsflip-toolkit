import { bytesToHex, hexToBytes } from './bytes';

describe('bytes', () => {
  it('round-trips hex', () => {
    const hex = '00112233445566778899aabbccddeeff';
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
    expect(Array.from(hexToBytes('0aff'))).toEqual([10, 255]);
  });

  it('rejects malformed hex', () => {
    expect(() => hexToBytes('abc')).toThrow(/Invalid hex/);
    expect(() => hexToBytes('zz')).toThrow(/Invalid hex/);
  });
});
