import { Address, Keypair, Operation, Transaction, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { Stroops, toBigInt } from '../amount';
import { SimulationError, SorobanRpc, Submission } from './soroban-rpc';

/** Mirrors the contract's `PotStatus` (`#[repr(u32)]`: 0..3). */
export type OnChainPotStatus = 'open' | 'staked' | 'resolved' | 'refunded';

export interface OnChainPot {
  playerA: string;
  playerB: string;
  stakeAmount: Stroops;
  playerAStaked: boolean;
  playerBStaked: boolean;
  status: OnChainPotStatus;
  deadlineLedger: number;
}

export interface OnChainConfig {
  admin: string;
  resolver: string;
  token: string;
}

/** The contract's error codes (`contracts/pvp-escrow/src/lib.rs`). */
export const PvpEscrowError = {
  NotInitialized: 2,
  PotAlreadyExists: 4,
  PotNotFound: 5,
  PotNotOpen: 6,
  PotNotStaked: 7,
  NotAPlayerInPot: 8,
  AlreadyStaked: 9,
  InvalidStakeAmount: 10,
  InvalidWinner: 11,
  SamePlayer: 12,
  InvalidTimeout: 13,
  DeadlinePassed: 14,
  DeadlineNotReached: 15,
  NothingToClaim: 16,
} as const;

const STATUSES: OnChainPotStatus[] = ['open', 'staked', 'resolved', 'refunded'];

/**
 * Typed client for `contracts/pvp-escrow`: one method per contract call.
 *
 * Resolver calls (`openPot`, `resolve`, `refund`) are signed and submitted
 * here. Player calls (`stake`, `claim_refund`) need the player's signature,
 * so they are built as prepared transactions for a wallet to sign.
 *
 * Adapted from Stellar-songifi/Lyricsflip_server
 * `src/stellar/services/escrow-contract.service.ts` for the hardened
 * contract (timeouts, `claim_refund`, resolver read from storage).
 */
export class PvpEscrowClient {
  constructor(
    readonly rpc: SorobanRpc,
    readonly contractId: string,
  ) {}

  openPot(
    resolver: Keypair,
    params: { potId: string; playerA: string; playerB: string; stakeAmount: Stroops; timeoutLedgers: number },
  ): Promise<Submission> {
    return this.invokeAsResolver(resolver, 'open_pot', [
      potIdToScVal(params.potId),
      addressToScVal(params.playerA),
      addressToScVal(params.playerB),
      nativeToScVal(toBigInt(params.stakeAmount), { type: 'i128' }),
      nativeToScVal(params.timeoutLedgers, { type: 'u32' }),
    ]);
  }

  resolve(resolver: Keypair, potId: string, winner: string): Promise<Submission> {
    return this.invokeAsResolver(resolver, 'resolve', [potIdToScVal(potId), addressToScVal(winner)]);
  }

  refund(resolver: Keypair, potId: string): Promise<Submission> {
    return this.invokeAsResolver(resolver, 'refund', [potIdToScVal(potId)]);
  }

  /**
   * Builds `stake(potId, player)` with `player` as the source, ready for the
   * player's wallet to sign. `timeoutSeconds` is how long they have.
   */
  buildStake(potId: string, player: string, timeoutSeconds?: number): Promise<Transaction> {
    return this.rpc.buildInvocation(
      player,
      this.contractId,
      'stake',
      [potIdToScVal(potId), addressToScVal(player)],
      timeoutSeconds,
    );
  }

  /**
   * Builds `claim_refund(potId, player)` for a player to reclaim their own
   * stake after the pot's deadline. Needs no server at all.
   */
  buildClaimRefund(potId: string, player: string, timeoutSeconds?: number): Promise<Transaction> {
    return this.rpc.buildInvocation(
      player,
      this.contractId,
      'claim_refund',
      [potIdToScVal(potId), addressToScVal(player)],
      timeoutSeconds,
    );
  }

  /**
   * Throws unless `transaction` is exactly one `stake(potId, player)` call on
   * this contract. Run it on any envelope a client hands back before it is
   * submitted, so a wallet can't smuggle in a different operation.
   */
  assertIsStake(transaction: Transaction, potId: string, player: string): void {
    const reject = (reason: string): never => {
      throw new InvalidStakeEnvelopeError(reason);
    };
    const operations = transaction.operations ?? [];
    if (operations.length !== 1) reject('it must contain exactly one operation');
    const [operation] = operations;
    if (operation.type !== 'invokeHostFunction') reject('it is not a contract invocation');
    const func = (operation as Operation.InvokeHostFunction).func;
    if (func.type !== 'hostFunctionTypeInvokeContract') {
      return reject('it is not a contract call');
    }
    const call = func.invokeContract;
    if (Address.fromScAddress(call.contractAddress).toString() !== this.contractId) {
      reject('it calls a different contract');
    }
    if (call.functionName.toString() !== 'stake') reject('it calls a different function');
    const expected = [potIdToScVal(potId), addressToScVal(player)].map((a) => a.toXDR('base64'));
    const actual = call.args.map((a: xdr.ScVal) => a.toXDR('base64'));
    if (actual.length !== expected.length || actual.some((a: string, i: number) => a !== expected[i])) {
      reject('it is for a different pot or player');
    }
  }

  /** Reads a pot; `null` if the contract has none for `potId`. */
  async getPot(potId: string): Promise<OnChainPot | null> {
    let raw: Record<string, unknown>;
    try {
      raw = (await this.rpc.read(this.contractId, 'get_pot', [potIdToScVal(potId)])) as Record<string, unknown>;
    } catch (err) {
      if (isContractError(err, PvpEscrowError.PotNotFound)) return null;
      throw err;
    }
    return {
      playerA: String(raw.player_a),
      playerB: String(raw.player_b),
      stakeAmount: String(raw.stake_amount),
      playerAStaked: Boolean(raw.player_a_staked),
      playerBStaked: Boolean(raw.player_b_staked),
      status: decodeStatus(raw.status),
      deadlineLedger: Number(raw.deadline_ledger),
    };
  }

  async getConfig(): Promise<OnChainConfig> {
    const raw = (await this.rpc.read(this.contractId, 'get_config', [])) as Record<string, unknown>;
    return { admin: String(raw.admin), resolver: String(raw.resolver), token: String(raw.token) };
  }

  private async invokeAsResolver(resolver: Keypair, method: string, args: xdr.ScVal[]): Promise<Submission> {
    const transaction = await this.rpc.buildInvocation(resolver.publicKey(), this.contractId, method, args);
    return this.rpc.signAndSubmit(transaction, [resolver]);
  }
}

export class InvalidStakeEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Transaction is not the stake issued for this wager: ${reason}`);
    this.name = 'InvalidStakeEnvelopeError';
  }
}

/**
 * The contract keys pots by `BytesN<16>`: a UUID is exactly 16 bytes once
 * the dashes are gone, so no hashing or truncation is needed.
 */
export function potIdToScVal(potId: string): xdr.ScVal {
  const hex = potId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`Pot id "${potId}" is not a UUID`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
}

export function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/** True if `err` is a simulation failure carrying contract error `code`. */
export function isContractError(err: unknown, code: number): boolean {
  return err instanceof SimulationError && err.message.includes(`Error(Contract, #${code})`);
}

function decodeStatus(value: unknown): OnChainPotStatus {
  if (typeof value === 'number' && STATUSES[value]) return STATUSES[value];
  if (typeof value === 'string') {
    const lower = value.toLowerCase() as OnChainPotStatus;
    if (STATUSES.includes(lower)) return lower;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') return decodeStatus(value[0]);
  throw new Error(`Unrecognised pot status ${JSON.stringify(value)}`);
}
