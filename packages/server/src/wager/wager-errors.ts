import { BadRequestException } from '@nestjs/common';

/**
 * Stable, user-facing error codes for wager/stake operations.
 *
 * These codes are part of the public API contract and must remain stable.
 * Each code maps to a fixed, human-readable message that is safe to return
 * to clients. Raw downstream details (XDR, RPC URLs, SDK internals) are
 * NEVER included in the message; they are logged server-side instead.
 */
export enum WagerErrorCode {
  /** The stake was rejected by the escrow contract or downstream service. */
  STAKE_REJECTED = 'STAKE_REJECTED',
  /** The player does not have sufficient balance to cover the stake. */
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  /** The pot is no longer accepting stakes (expired or closed). */
  POT_EXPIRED = 'POT_EXPIRED',
  /** The pot has not been staked yet / is not in a stakeable state. */
  POT_NOT_STAKED = 'POT_NOT_STAKED',
  /** The stake envelope was invalid or malformed. */
  INVALID_ENVELOPE = 'INVALID_ENVELOPE',
  /** Building the stake transaction failed. */
  STAKE_BUILD_FAILED = 'STAKE_BUILD_FAILED',
  /** The wager or pot could not be found. */
  NOT_FOUND = 'NOT_FOUND',
  /** The operation is not allowed in the current wager state. */
  INVALID_STATE = 'INVALID_STATE',
  /** A generic, unmapped failure. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Documented, stable user-facing messages for each error code.
 */
export const WAGER_ERROR_MESSAGES: Readonly<Record<WagerErrorCode, string>> = Object.freeze({
  [WagerErrorCode.STAKE_REJECTED]: 'Your stake was rejected. Please try again.',
  [WagerErrorCode.INSUFFICIENT_BALANCE]: 'You do not have enough balance to cover this stake.',
  [WagerErrorCode.POT_EXPIRED]: 'This pot is no longer accepting stakes.',
  [WagerErrorCode.POT_NOT_STAKED]: 'This pot is not ready for staking.',
  [WagerErrorCode.INVALID_ENVELOPE]: 'The stake request was invalid. Please try again.',
  [WagerErrorCode.STAKE_BUILD_FAILED]: 'We could not prepare your stake. Please try again.',
  [WagerErrorCode.NOT_FOUND]: 'The requested wager could not be found.',
  [WagerErrorCode.INVALID_STATE]: 'This action is not allowed right now.',
  [WagerErrorCode.INTERNAL_ERROR]: 'Something went wrong. Please try again later.',
});

/**
 * Shape of a mapped error returned by {@link mapWagerError}.
 */
export interface MappedWagerError {
  code: WagerErrorCode;
  message: string;
}

/**
 * Known SDK error codes (from PvpEscrowError) mapped to user-facing codes.
 */
const SDK_ERROR_CODE_MAP: Readonly<Record<string, WagerErrorCode>> = Object.freeze({
  // Contract / SDK error codes (numeric or symbolic) mapped to user-facing codes.
  INSUFFICIENT_BALANCE: WagerErrorCode.INSUFFICIENT_BALANCE,
  INSUFFICIENT_FUNDS: WagerErrorCode.INSUFFICIENT_BALANCE,
  POT_EXPIRED: WagerErrorCode.POT_EXPIRED,
  POT_CLOSED: WagerErrorCode.POT_EXPIRED,
  POT_NOT_STAKED: WagerErrorCode.POT_NOT_STAKED,
  NOT_STAKED: WagerErrorCode.POT_NOT_STAKED,
  INVALID_ENVELOPE: WagerErrorCode.INVALID_ENVELOPE,
  INVALID_STAKE_ENVELOPE: WagerErrorCode.INVALID_ENVELOPE,
  STAKE_REJECTED: WagerErrorCode.STAKE_REJECTED,
  STAKE_BUILD_FAILED: WagerErrorCode.STAKE_BUILD_FAILED,
  NOT_FOUND: WagerErrorCode.NOT_FOUND,
  INVALID_STATE: WagerErrorCode.INVALID_STATE,
});

/**
 * Substrings found in contract error strings mapped to user-facing codes.
 * Matching is case-insensitive.
 */
const CONTRACT_ERROR_SUBSTRING_MAP: ReadonlyArray<[string, WagerErrorCode]> = [
  ['insufficient balance', WagerErrorCode.INSUFFICIENT_BALANCE],
  ['insufficient funds', WagerErrorCode.INSUFFICIENT_BALANCE],
  ['pot expired', WagerErrorCode.POT_EXPIRED],
  ['pot closed', WagerErrorCode.POT_EXPIRED],
  ['pot not staked', WagerErrorCode.POT_NOT_STAKED],
  ['not staked', WagerErrorCode.POT_NOT_STAKED],
  ['invalid envelope', WagerErrorCode.INVALID_ENVELOPE],
  ['invalid stake envelope', WagerErrorCode.INVALID_ENVELOPE],
  ['stake rejected', WagerErrorCode.STAKE_REJECTED],
  ['stake build failed', WagerErrorCode.STAKE_BUILD_FAILED],
  ['not found', WagerErrorCode.NOT_FOUND],
  ['invalid state', WagerErrorCode.INVALID_STATE],
];

/**
 * Extracts a candidate error code string from an arbitrary downstream error.
 * Handles SDK errors that expose a `code` property, contract error strings,
 * and generic Error instances. Returns undefined when nothing usable is found.
 */
function extractErrorCode(error: unknown): string | undefined {
  if (error == null) {
    return undefined;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error === 'object') {
    const candidate = error as Record<string, unknown>;

    // SDK PvpEscrowError and similar expose a `code` field.
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
      return String(candidate.code);
    }

    // Some errors nest the underlying cause.
    if (candidate.cause != null) {
      const nested = extractErrorCode(candidate.cause);
      if (nested) {
        return nested;
      }
    }

    if (typeof candidate.message === 'string') {
      return candidate.message;
    }
  }

  return undefined;
}

/**
 * Determines whether the given error is an InvalidStakeEnvelopeError.
 * Detection is duck-typed to avoid a hard dependency on the SDK class.
 */
function isInvalidStakeEnvelopeError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }
  const candidate = error as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  return (
    name === 'InvalidStakeEnvelopeError' ||
    code === 'INVALID_ENVELOPE' ||
    code === 'INVALID_STAKE_ENVELOPE'
  );
}

/**
 * Maps a downstream error (SDK PvpEscrowError, contract error string,
 * InvalidStakeEnvelopeError, or generic Error) to a stable user-facing
 * error code and message.
 *
 * The returned message NEVER contains raw XDR, RPC URLs, or other internal
 * details. Callers should log the original error server-side.
 */
export function mapWagerError(error: unknown): MappedWagerError {
  if (isInvalidStakeEnvelopeError(error)) {
    return {
      code: WagerErrorCode.INVALID_ENVELOPE,
      message: WAGER_ERROR_MESSAGES[WagerErrorCode.INVALID_ENVELOPE],
    };
  }

  const rawCode = extractErrorCode(error);

  if (rawCode) {
    // Exact match against known SDK codes (case-insensitive).
    const normalized = rawCode.trim().toUpperCase();
    const exact = SDK_ERROR_CODE_MAP[normalized];
    if (exact) {
      return { code: exact, message: WAGER_ERROR_MESSAGES[exact] };
    }

    // Substring match against contract error strings.
    const lower = rawCode.toLowerCase();
    for (const [needle, code] of CONTRACT_ERROR_SUBSTRING_MAP) {
      if (lower.includes(needle)) {
        return { code, message: WAGER_ERROR_MESSAGES[code] };
      }
    }
  }

  return {
    code: WagerErrorCode.INTERNAL_ERROR,
    message: WAGER_ERROR_MESSAGES[WagerErrorCode.INTERNAL_ERROR],
  };
}

/**
 * Builds a BadRequestException from a mapped wager error. The response body
 * contains only the stable code and message — never raw downstream details.
 */
export function toBadRequestException(mapped: MappedWagerError): BadRequestException {
  return new BadRequestException({
    code: mapped.code,
    message: mapped.message,
  });
}

/**
 * Convenience helper: maps a downstream error and returns a
 * BadRequestException carrying only the stable code and message.
 */
export function buildWagerBadRequest(error: unknown): BadRequestException {
  return toBadRequestException(mapWagerError(error));
}