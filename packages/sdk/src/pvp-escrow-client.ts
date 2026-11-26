import {
  Address,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  xdr,
} from '@stellar/stellar-sdk';
import { Stroops, toBigInt } from './amount';
import { hexToBytes } from './bytes';
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
  /** Platform fee taken from each resolved pot, in basis points (0 = none). */
  feeBps: number;
  /** Receives the platform fee; `null` while `feeBps` is 0. */
  feeRecipient: string | null;
}

/**
 * The contract's `Resolved` event. `payout` went to the winner and `fee` to
 * `feeRecipient`; `payout + fee` is exactly the pot (`2 × stakeAmount`).
 */
export interface ResolvedEvent {
  sessionId: string;
  winner: string;
  payout: Stroops;
  fee: Stroops;
  feeRecipient: string | null;
}

/** Highest platform fee the contract accepts, in basis points (10%). */
export const MAX_FEE_BPS = 1_000;

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
  NoPendingAdmin: 18,
  InvalidFee: 19,
  Paused: 17,
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

  /**
   * For smart wallets (contract `C...` accounts) and other relayed stakes:
   * simulates `stake(potId, player)` from `relayer` and returns the player's
   * Soroban authorisation entry to sign, instead of a whole transaction.
   *
   * The wallet signs the entry (its `signatureExpirationLedger` is already set
   * to `validForLedgers` from now), and the relayer submits it with
   * {@link buildStakeWithAuth}. `relayer` is the account that will pay the
   * fee and be the transaction source.
   */
  async buildStakeAuth(
    potId: string,
    player: string,
    relayer: string,
    validForLedgers = 100,
  ): Promise<StakeAuthRequest> {
    const transaction = await this.rpc.buildInvocation(relayer, this.contractId, 'stake', [
      potIdToScVal(potId),
      addressToScVal(player),
    ]);
    const operation = transaction.operations[0] as Operation.InvokeHostFunction;
    const entries = (operation.auth ?? []).filter((entry) => {
      const credentials = addressCredentials(entry);
      return credentials !== null && Address.fromScAddress(credentials.address).toString() === player;
    });
    if (entries.length !== 1) {
      throw new Error(`Expected one authorisation entry for ${player}, found ${entries.length}`);
    }
    const unsigned = entries[0];
    const credentials = addressCredentials(unsigned) as xdr.SorobanAddressCredentials;
    const latest = await this.rpc.server.getLatestLedger();
    const expirationLedger = latest.sequence + validForLedgers;
    // XDR values are immutable: rebuild the entry with the expiration set.
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: credentials.address,
          nonce: credentials.nonce,
          signatureExpirationLedger: expirationLedger,
          signature: credentials.signature,
        }),
      ),
      rootInvocation: unsigned.rootInvocation,
    });
    this.assertIsStakeAuth(entry, potId, player);
    return {
      authEntryXdr: entry.toXDR('base64'),
      transactionXdr: transaction.toXDR(),
      expirationLedger,
      networkPassphrase: this.rpc.networkPassphrase,
    };
  }

  /**
   * Throws unless `entry` is an address-credentials authorisation by `player`
   * for exactly `stake(potId, player)` on this contract. The only nested call
   * it may also authorise is the stake's own token `transfer` from `player`
   * to this contract. Run it on every entry a client hands back.
   */
  assertIsStakeAuth(entry: xdr.SorobanAuthorizationEntry, potId: string, player: string): void {
    const reject = (reason: string): never => {
      throw new InvalidStakeAuthError(reason);
    };
    const credentials = addressCredentials(entry);
    if (!credentials) return reject('it is not signed by an address');
    if (Address.fromScAddress(credentials.address).toString() !== player) {
      reject('it is signed for a different player');
    }
    const root = entry.rootInvocation;
    const call = contractCall(root.function);
    if (!call) return reject('it does not authorise a contract call');
    if (Address.fromScAddress(call.contractAddress).toString() !== this.contractId) {
      reject('it authorises a different contract');
    }
    if (call.functionName.toString() !== 'stake') reject('it authorises a different function');
    const expected = [potIdToScVal(potId), addressToScVal(player)].map((a) => a.toXDR('base64'));
    const actual = call.args.map((a: xdr.ScVal) => a.toXDR('base64'));
    if (actual.length !== expected.length || actual.some((a: string, i: number) => a !== expected[i])) {
      reject('it is for a different pot or player');
    }
    for (const sub of root.subInvocations) {
      const nested = contractCall(sub.function);
      const args = nested?.args ?? [];
      const isStakeTransfer =
        nested !== null &&
        nested.functionName.toString() === 'transfer' &&
        sub.subInvocations.length === 0 &&
        args.length === 3 &&
        args[0].toXDR('base64') === addressToScVal(player).toXDR('base64') &&
        args[1].toXDR('base64') === addressToScVal(this.contractId).toXDR('base64');
      if (!isStakeTransfer) reject('it authorises calls other than the stake transfer');
    }
  }

  /**
   * Builds `stake(potId, player)` from `relayer` carrying the player's signed
   * authorisation entry, re-simulated so the footprint and fees reflect the
   * signature. The relayer signs and submits the result.
   */
  async buildStakeWithAuth(
    potId: string,
    player: string,
    signedAuthEntry: xdr.SorobanAuthorizationEntry,
    relayer: string,
  ): Promise<Transaction> {
    this.assertIsStakeAuth(signedAuthEntry, potId, player);
    const account = await this.rpc.server.getAccount(relayer);
    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.rpc.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: this.contractId,
          function: 'stake',
          args: [potIdToScVal(potId), addressToScVal(player)],
          auth: [signedAuthEntry],
        }),
      )
      .setTimeout(60)
      .build();
    const simulation = await this.rpc.server.simulateTransaction(transaction);
    if (StellarRpc.Api.isSimulationError(simulation)) {
      throw new SimulationError('stake', this.contractId, simulation.error);
    }
    // Keeps the signed entry: assembly only adds simulated auth to operations
    // that carry none.
    return StellarRpc.assembleTransaction(transaction, simulation).build();
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
    const feeRecipient = raw.fee_recipient;
    return {
      admin: String(raw.admin),
      resolver: String(raw.resolver),
      token: String(raw.token),
      feeBps: Number(raw.fee_bps ?? 0),
      feeRecipient: feeRecipient === null || feeRecipient === undefined ? null : String(feeRecipient),
    };
  }

  /**
   * Resolver calls go through `submitSequenced`, so concurrent settlements
   * from one process never collide on the resolver's sequence number (#59).
   */
  private invokeAsResolver(resolver: Keypair, method: string, args: xdr.ScVal[]): Promise<Submission> {
    return this.rpc.submitSequenced(resolver, (account) =>
      this.rpc.buildInvocation(account, this.contractId, method, args),
    );
  }
}

/** What {@link PvpEscrowClient.buildStakeAuth} returns for a wallet to sign. */
export interface StakeAuthRequest {
  /** Base64 `SorobanAuthorizationEntry` to sign (credentials not yet signed). */
  authEntryXdr: string;
  /** The simulated transaction the entry came from, for display/inspection. */
  transactionXdr: string;
  /** Last ledger at which the signature is valid. */
  expirationLedger: number;
  networkPassphrase: string;
}

export class InvalidStakeAuthError extends Error {
  constructor(reason: string) {
    super(`Authorisation entry is not the stake issued for this wager: ${reason}`);
    this.name = 'InvalidStakeAuthError';
  }
}

function contractCall(fn: xdr.SorobanAuthorizedFunction): xdr.InvokeContractArgs | null {
  return fn.type === 'sorobanAuthorizedFunctionTypeContractFn' ? fn.contractFn : null;
}

/** The address credentials of an entry, or `null` for source-account auth. */
export function addressCredentials(entry: xdr.SorobanAuthorizationEntry): xdr.SorobanAddressCredentials | null {
  const credentials = entry.credentials;
  if (credentials.type === 'sorobanCredentialsAddress') return credentials.address;
  if (credentials.type === 'sorobanCredentialsAddressV2') return credentials.addressV2;
  return null;
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
  return xdr.ScVal.scvBytes(hexToBytes(hex));
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
