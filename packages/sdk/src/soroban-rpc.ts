import {
  Account,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { bytesToHex } from './bytes';

/** Any valid account id works as the source of a read-only simulation. */
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * What a submission is known to have done.
 * - `confirmed`: in a ledger, succeeded.
 * - `pending`: may or may not land; reconcile, don't retry blindly.
 * - `failed`: definitely changed nothing.
 */
export type SubmissionStatus = 'confirmed' | 'pending' | 'failed';

export interface Submission {
  status: SubmissionStatus;
  hash: string;
  ledger?: number;
  returnValue?: unknown;
  error?: string;
}

export interface SorobanRpcOptions {
  rpcUrl: string;
  networkPassphrase: string;
  /** Fee ceiling per operation, in stroops. Default 10,000,000 (1 XLM). */
  maxFee?: bigint;
  /** Seconds a built transaction stays valid. Default 60. */
  timeoutSeconds?: number;
  /**
   * Per-request HTTP timeout, in milliseconds. Default 15,000. `0` disables it.
   *
   * Not to be confused with `timeoutSeconds`, which is the ledger validity
   * window of a built transaction. This one bounds the HTTP request itself:
   * without it a slow or unresponsive RPC node never answers and every call
   * (`buildInvocation`, `read`, `sendTransaction`, `getTransaction`) hangs
   * indefinitely, holding the settlement request handler open.
   */
  httpTimeoutMs?: number;
  /** Poll attempts (about one per second) before calling a submission pending. Default 30. */
  pollAttempts?: number;
  /** Resubmissions when the network queue is full. Default 5. */
  tryAgainAttempts?: number;
  /** Immediate retries, with a refreshed sequence number, after `txBAD_SEQ`. Default 3. */
  badSeqRetries?: number;
}

const DEFAULT_MAX_FEE = 10_000_000n;
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

/**
 * A small wrapper around Soroban JSON-RPC that keeps fee policy, retries and
 * the pending/failed distinction in one place.
 *
 * Ported from Stellar-songifi/Lyricsflip_server
 * `src/stellar/services/stellar-rpc.service.ts`, without NestJS, metrics or
 * Node-only APIs (it runs in React Native),
 * and with `pending` kept separate from `failed`: an unknown outcome must
 * never be treated as a definite failure, or a retry could pay twice.
 */
export class SorobanRpc {
  readonly server: rpc.Server;
  readonly networkPassphrase: string;
  /** Per-request HTTP timeout applied to every RPC call, in milliseconds. */
  readonly httpTimeoutMs: number;
  private readonly maxFee: bigint;
  private readonly timeoutSeconds: number;
  private readonly pollAttempts: number;
  private readonly tryAgainAttempts: number;
  private readonly badSeqRetries: number;
  /** Last sequence number this process spent, per source account. */
  private readonly sequences = new Map<string, string>();
  /** Tail of the queue of submissions per source account. */
  private readonly sourceLocks = new Map<string, Promise<void>>();

  constructor(options: SorobanRpcOptions) {
    this.server = new rpc.Server(options.rpcUrl, { allowHttp: options.rpcUrl.startsWith('http://') });
    this.httpTimeoutMs = options.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
    // `rpc.Server`'s own `timeout` option is declared but never forwarded to its
    // HTTP client, so passing it there is a no-op and a slow node hangs forever
    // (verified against @stellar/stellar-sdk 17.2.0). `httpClient.defaults` is
    // the extension point the SDK documents for per-server HTTP config, and its
    // `timeout` cancels the in-flight fetch through `AbortSignal.timeout` /
    // `AbortController` — so the socket is released instead of merely abandoned.
    // Every call, including `sendTransaction` and the `pollTransaction` loop,
    // goes through this same client.
    this.server.httpClient.defaults.timeout = this.httpTimeoutMs;
    this.networkPassphrase = options.networkPassphrase;
    this.maxFee = options.maxFee ?? DEFAULT_MAX_FEE;
    this.timeoutSeconds = options.timeoutSeconds ?? 60;
    this.pollAttempts = options.pollAttempts ?? 30;
    this.tryAgainAttempts = options.tryAgainAttempts ?? 5;
    this.badSeqRetries = options.badSeqRetries ?? 3;
  }

  /**
   * Builds `contractId.method(args)` from `source` and simulates it, so the
   * transaction carries the footprint, resource fee and auth entries.
   * Throws if simulation fails; nothing has been submitted at that point.
   */
  async buildInvocation(
    source: string | Account,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    timeoutSeconds = this.timeoutSeconds,
  ): Promise<Transaction> {
    const account = typeof source === 'string' ? await this.server.getAccount(source) : source;
    const transaction = new TransactionBuilder(account, {
      fee: await this.inclusionFee(),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(timeoutSeconds)
      .build();
    try {
      return await this.server.prepareTransaction(transaction);
    } catch (err) {
      throw new SimulationError(method, contractId, err);
    }
  }

  /** Simulates a read-only call and returns its decoded result. Costs nothing. */
  async read(contractId: string, method: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(SIMULATION_SOURCE, '0');
    const transaction = new TransactionBuilder(source, {
      fee: this.maxFee.toString(),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(this.timeoutSeconds)
      .build();
    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new SimulationError(method, contractId, simulation.error);
    }
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new SimulationError(method, contractId, 'no return value');
    }
    return scValToNative(simulation.result.retval);
  }

  /**
   * Builds, signs and submits a transaction from `signer`'s account without
   * two concurrent calls colliding on its sequence number (#59).
   *
   * Calls for the same account are serialised from building until the network
   * has *accepted* the transaction, using a locally tracked sequence number;
   * waiting for the ledger happens outside the lock, so throughput isn't
   * limited by confirmation time. A `txBAD_SEQ` rejection (another process, or
   * a stale cache) refreshes the sequence from the network and retries at
   * once, up to `badSeqRetries` times, instead of surfacing as a failure.
   */
  async submitSequenced(
    signer: Keypair,
    build: (account: Account) => Promise<Transaction>,
  ): Promise<Submission> {
    const source = signer.publicKey();
    type Queued = { done: Submission } | { hash: string };
    const queued = await this.withSourceLock<Queued>(source, async () => {
      for (let attempt = 0; ; attempt++) {
        const cached = this.sequences.get(source) ?? (await this.server.getAccount(source)).sequenceNumber();
        // TransactionBuilder bumps the account it is given; hand it a copy.
        const transaction = await build(new Account(source, cached));
        transaction.sign(signer);
        const hash = hashHex(transaction);
        let sent: rpc.Api.SendTransactionResponse;
        try {
          sent = await this.sendWithBackoff(transaction);
        } catch (err) {
          // Unknown whether it reached the network: the sequence may be spent.
          this.sequences.delete(source);
          return { done: { status: 'pending', hash, error: `Submission error: ${message(err)}` } };
        }
        if (sent.status === 'ERROR') {
          this.sequences.delete(source); // nothing was consumed, or our view is stale
          if (isBadSeq(sent) && attempt < this.badSeqRetries) continue;
          return {
            done: {
              status: 'failed',
              hash,
              error: `Rejected by the network: ${sent.errorResult?.toXDR('base64') ?? 'no result'}`,
            },
          };
        }
        if (sent.status === 'TRY_AGAIN_LATER') {
          this.sequences.delete(source);
          return { done: { status: 'failed', hash, error: 'Network queue full (TRY_AGAIN_LATER)' } };
        }
        // Accepted: the sequence is spent whether or not the transaction succeeds.
        this.sequences.set(source, transaction.sequence);
        return { hash };
      }
    });
    if ('done' in queued) return queued.done;
    return this.waitFor(queued.hash);
  }

  /** Runs `task` after every earlier task for `source` has finished. */
  private async withSourceLock<T>(source: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sourceLocks.get(source) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const chained = previous.then(() => current);
    this.sourceLocks.set(source, chained);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.sourceLocks.get(source) === chained) this.sourceLocks.delete(source);
    }
  }

  private async sendWithBackoff(transaction: Transaction): Promise<rpc.Api.SendTransactionResponse> {
    for (let attempt = 0; ; attempt++) {
      const sent = await this.server.sendTransaction(transaction);
      if (sent.status !== 'TRY_AGAIN_LATER' || attempt >= this.tryAgainAttempts) return sent;
      await sleep(500 * 2 ** attempt);
    }
  }

  /** Signs with `signers` and submits. */
  async signAndSubmit(transaction: Transaction, signers: Keypair[]): Promise<Submission> {
    for (const signer of signers) transaction.sign(signer);
    return this.submit(transaction);
  }

  /**
   * Submits a signed transaction and waits for it to reach a ledger.
   * `sendTransaction` only queues; a queued transaction can still fail, so
   * this polls before reporting anything as confirmed.
   */
  async submit(transaction: Transaction | FeeBumpTransaction): Promise<Submission> {
    const hash = hashHex(transaction);
    let sent: rpc.Api.SendTransactionResponse;
    for (let attempt = 0; ; attempt++) {
      try {
        sent = await this.server.sendTransaction(transaction);
      } catch (err) {
        // The request may have reached the network before failing.
        return { status: 'pending', hash, error: `Submission error: ${message(err)}` };
      }
      // TRY_AGAIN_LATER means the queue was full and the transaction was
      // not accepted; back off and resend.
      if (sent.status !== 'TRY_AGAIN_LATER') break;
      if (attempt >= this.tryAgainAttempts) {
        return { status: 'failed', hash, error: 'Network queue full (TRY_AGAIN_LATER)' };
      }
      await sleep(500 * 2 ** attempt);
    }
    if (sent.status === 'ERROR') {
      return {
        status: 'failed',
        hash,
        error: `Rejected by the network: ${sent.errorResult?.toXDR('base64') ?? 'no result'}`,
      };
    }
    // PENDING, or DUPLICATE (this exact transaction is already in flight).
    return this.waitFor(hash);
  }

  /** Polls a submitted transaction; `pending` if it isn't visible yet. */
  async waitFor(hash: string): Promise<Submission> {
    try {
      const result = await this.server.pollTransaction(hash, {
        attempts: this.pollAttempts,
        sleepStrategy: rpc.LinearSleepStrategy,
      });
      return toSubmission(hash, result);
    } catch (err) {
      return { status: 'pending', hash, error: `Could not confirm: ${message(err)}` };
    }
  }

  /** Looks a transaction up once, for reconciliation. */
  async lookup(hash: string): Promise<Submission> {
    try {
      return toSubmission(hash, await this.server.getTransaction(hash));
    } catch (err) {
      return { status: 'pending', hash, error: `Lookup failed: ${message(err)}` };
    }
  }

  /**
   * Wraps a player-signed `inner` transaction in a fee-bump paid by
   * `feeSource` (#60), so the player needs no XLM for fees. The inner
   * transaction is unchanged, so its signatures and checks
   * (`assertIsStake`) still apply. Returns the signed fee-bump and the most it
   * can cost, in stroops.
   *
   * Only the server builds fee-bumps: `fromXdr` keeps refusing fee-bump
   * envelopes sent by clients.
   */
  sponsorFee(inner: Transaction, feeSource: Keypair): { transaction: FeeBumpTransaction; maxFee: bigint } {
    // The fee-bump's per-operation rate must cover the inner rate, including
    // the Soroban resource fee, so bid the inner fee per operation.
    const transaction = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      inner.fee,
      inner,
      this.networkPassphrase,
    );
    transaction.sign(feeSource);
    return { transaction, maxFee: BigInt(transaction.fee) };
  }

  /** Deserialises an envelope a wallet signed and returned. */
  fromXdr(envelope: string): Transaction {
    const parsed = TransactionBuilder.fromXDR(envelope, this.networkPassphrase);
    if (!(parsed instanceof Transaction)) {
      throw new Error('Fee-bump envelopes are not accepted here');
    }
    return parsed;
  }

  /** p90 of recent Soroban inclusion fees, capped at `maxFee`. */
  private async inclusionFee(): Promise<string> {
    try {
      const stats = await this.server.getFeeStats();
      const p90 = BigInt(stats.sorobanInclusionFee.p90);
      if (p90 <= 0n) return '100';
      return (p90 < this.maxFee ? p90 : this.maxFee).toString();
    } catch {
      return '100';
    }
  }
}

export class SimulationError extends Error {
  constructor(method: string, contractId: string, cause: unknown) {
    super(`Simulation of ${method} on ${contractId} failed: ${message(cause)}`);
    this.name = 'SimulationError';
  }
}

/** Hex hash; `Transaction.hash()` is a Uint8Array with no radix `toString`. */
export function hashHex(transaction: Transaction | FeeBumpTransaction): string {
  return bytesToHex(transaction.hash());
}

function toSubmission(hash: string, result: rpc.Api.GetTransactionResponse): Submission {
  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      status: 'confirmed',
      hash,
      ledger: result.ledger,
      returnValue: result.returnValue ? scValToNative(result.returnValue) : undefined,
    };
  }
  if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
    return { status: 'failed', hash, ledger: result.ledger, error: 'Transaction failed on-chain' };
  }
  return { status: 'pending', hash, error: 'Not visible on the network yet' };
}

/** True when the network rejected a transaction for a stale sequence number. */
export function isBadSeq(sent: rpc.Api.SendTransactionResponse): boolean {
  const result = sent.errorResult?.result as { type?: string } | undefined;
  return result?.type === 'txBadSeq';
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
