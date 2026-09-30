import {
  Account,
  Contract,
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

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
  /** Poll attempts (about one per second) before calling a submission pending. Default 30. */
  pollAttempts?: number;
  /** Resubmissions when the network queue is full. Default 5. */
  tryAgainAttempts?: number;
}

const DEFAULT_MAX_FEE = 10_000_000n;

/**
 * A small wrapper around Soroban JSON-RPC that keeps fee policy, retries and
 * the pending/failed distinction in one place.
 *
 * Ported from Stellar-songifi/Lyricsflip_server
 * `src/stellar/services/stellar-rpc.service.ts`, without NestJS or metrics,
 * and with `pending` kept separate from `failed`: an unknown outcome must
 * never be treated as a definite failure, or a retry could pay twice.
 */
export class SorobanRpc {
  readonly server: rpc.Server;
  readonly networkPassphrase: string;
  private readonly maxFee: bigint;
  private readonly timeoutSeconds: number;
  private readonly pollAttempts: number;
  private readonly tryAgainAttempts: number;

  constructor(options: SorobanRpcOptions) {
    this.server = new rpc.Server(options.rpcUrl, { allowHttp: options.rpcUrl.startsWith('http://') });
    this.networkPassphrase = options.networkPassphrase;
    this.maxFee = options.maxFee ?? DEFAULT_MAX_FEE;
    this.timeoutSeconds = options.timeoutSeconds ?? 60;
    this.pollAttempts = options.pollAttempts ?? 30;
    this.tryAgainAttempts = options.tryAgainAttempts ?? 5;
  }

  /**
   * Builds `contractId.method(args)` from `source` and simulates it, so the
   * transaction carries the footprint, resource fee and auth entries.
   * Throws if simulation fails; nothing has been submitted at that point.
   */
  async buildInvocation(
    source: string,
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    timeoutSeconds = this.timeoutSeconds,
  ): Promise<Transaction> {
    const account = await this.server.getAccount(source);
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
    // Any valid account id works as the source of a simulation.
    const source = new Account(Keypair.random().publicKey(), '0');
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
  async submit(transaction: Transaction): Promise<Submission> {
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
        error: `Rejected: ${sent.errorResult?.result().switch().name ?? 'unknown'}`,
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
export function hashHex(transaction: Transaction): string {
  return Buffer.from(transaction.hash()).toString('hex');
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
