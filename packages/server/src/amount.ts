/**
 * Token amounts in base units ("stroops"), carried as decimal strings.
 *
 * Amounts are never a JavaScript `number`: Soroban stores them as i128, and a
 * 7-decimal token overflows the 2^53 safe-integer range at ~900 million
 * tokens. Strings cross the database, the API and the network without losing
 * a stroop; convert to `bigint` for arithmetic.
 *
 * Ported from Stellar-songifi/Lyricsflip_server `src/stellar/amount.util.ts`.
 */
export type Stroops = string;

/** Decimal places of a Stellar classic asset (and of most Soroban tokens). */
export const TOKEN_DECIMALS = 7;
export const STROOPS_PER_TOKEN = 10n ** BigInt(TOKEN_DECIMALS);
export const I128_MAX = (1n << 127n) - 1n;
export const I128_MIN = -(1n << 127n);

const DISPLAY_AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;
const STROOPS_PATTERN = /^-?\d+$/;

/** Thrown for a malformed or out-of-range amount. */
export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

/** Parses a stroop string, rejecting anything that isn't a whole i128. */
export function toBigInt(stroops: Stroops): bigint {
  if (typeof stroops !== 'string' || !STROOPS_PATTERN.test(stroops)) {
    throw new InvalidAmountError(
      `Invalid stroop amount "${String(stroops)}": expected a whole number as a string`,
    );
  }
  const value = BigInt(stroops);
  if (value > I128_MAX || value < I128_MIN) {
    throw new InvalidAmountError(`Stroop amount "${stroops}" does not fit in an i128`);
  }
  return value;
}

/**
 * Converts a display amount ("10", "10.5", "0.0000001") into stroops, on the
 * string itself so values like "0.1" survive exactly.
 */
export function toStroops(displayAmount: string): Stroops {
  if (typeof displayAmount !== 'string') {
    throw new InvalidAmountError('Token amounts must be strings to avoid float rounding');
  }
  const trimmed = displayAmount.trim();
  if (!DISPLAY_AMOUNT_PATTERN.test(trimmed)) {
    throw new InvalidAmountError(
      `Invalid token amount "${displayAmount}": expected a non-negative decimal with at most ${TOKEN_DECIMALS} decimal places`,
    );
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const value = BigInt(whole) * STROOPS_PER_TOKEN + BigInt(fraction.padEnd(TOKEN_DECIMALS, '0'));
  if (value > I128_MAX) {
    throw new InvalidAmountError(`Token amount "${displayAmount}" is too large`);
  }
  return value.toString();
}

/** Converts stroops to a display string, keeping at least one decimal ("10.0"). */
export function fromStroops(stroops: Stroops): string {
  const value = toBigInt(stroops);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / STROOPS_PER_TOKEN;
  const fraction = (magnitude % STROOPS_PER_TOKEN)
    .toString()
    .padStart(TOKEN_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fraction || '0'}`;
}

export function addStroops(a: Stroops, b: Stroops): Stroops {
  return (toBigInt(a) + toBigInt(b)).toString();
}

export function multiplyStroops(a: Stroops, factor: number | bigint): Stroops {
  return (toBigInt(a) * BigInt(factor)).toString();
}

export function isAtLeast(a: Stroops, b: Stroops): boolean {
  return toBigInt(a) >= toBigInt(b);
}

/** Validates a stake and returns it normalised (no leading zeros). */
export function assertPositiveStroops(amount: Stroops, field = 'amount'): Stroops {
  const value = toBigInt(amount);
  if (value <= 0n) {
    throw new InvalidAmountError(`${field} must be greater than zero`);
  }
  return value.toString();
}
