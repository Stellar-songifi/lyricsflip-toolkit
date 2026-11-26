import type { SettlementMode } from './escrow/escrow.gateway';
import type { PvpEvent } from './wager/wager.events';

export const PVP_SETTLEMENT_OPTIONS = Symbol('PVP_SETTLEMENT_OPTIONS');

export type CustodyMode = 'non-custodial' | 'custodial';

export interface StellarSettlementOptions {
  /** `testnet`, `futurenet`, `local` or `public`. */
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  /** The deployed `pvp-escrow` contract (C...). */
  escrowContractId: string;
  /** The stake token contract (C...). */
  tokenContractId: string;
  /**
   * Secret key (S...) of the escrow's resolver. Static: parsed once at boot, so
   * it cannot be rotated without a restart. Use `resolverSecretProvider` when
   * that matters.
   */
  resolverSecret?: string;
  /**
   * Alternative to `resolverSecret`: called to fetch the resolver secret (S...)
   * before each resolver invocation (`openPot`, `resolve`, `refund`), so the key
   * can be rotated in a secrets manager without a restart. Results are cached
   * for `resolverSecretCacheTtlMs`, and concurrent calls share one read.
   *
   * One of `resolverSecret` / `resolverSecretProvider` is required in stellar
   * mode. A static secret is parsed once and can never change, so a provider is
   * what makes rotation possible without downtime.
   */
  resolverSecretProvider?: () => Promise<string>;
  /** How long a `resolverSecretProvider` result is trusted. Default 60,000 ms. */
  resolverSecretCacheTtlMs?: number;
  /** Default `non-custodial`: players sign their own stakes. */
  custodyMode?: CustodyMode;
  /**
   * Custodial mode only: returns the secret key (S...) that signs for this
   * player, or `null` to fall back to asking their wallet. Refused on `public`.
   */
  custodialPlayerSecret?: (playerId: string) => Promise<string | null> | string | null;
  /** Seconds a stake transaction stays valid for the wallet to sign. Default 300. */
  stakeTxTimeoutSeconds?: number;
  /** How long to poll for a submitted transaction before calling it `pending`. Default 30. */
  confirmTimeoutSeconds?: number;
  /**
   * Per-request HTTP timeout for RPC calls, in milliseconds: the bound on a
   * slow or unresponsive RPC node. Default 15,000; `0` disables it.
   *
   * Without it a hung node never answers, so `openPot`/`resolve` block the
   * request handler indefinitely and the wager never returns to the reconciler.
   */
  httpTimeoutMs?: number;
}

export interface Sep10Options {
  /** Secret key (S...) that signs SEP-10 challenges. Must be stable across restarts. */
  signingSecret: string;
  /** Home domain named in the challenge, e.g. `api.example.com`. */
  homeDomain: string;
  /** Domain of the auth endpoint. Defaults to `homeDomain`. */
  webAuthDomain?: string;
  networkPassphrase: string;
  /** Seconds a challenge stays valid. Default 300. */
  challengeTtlSeconds?: number;
}

export interface ReconcileOptions {
  /** Run the background reconcile/expiry loop. Default true. */
  enabled?: boolean;
  /** Seconds between sweeps. Default 60. */
  intervalSeconds?: number;
  /** Only reconcile wagers untouched for this long. Default 60. */
  minAgeSeconds?: number;
  /** Attempts before a settling wager goes to `failed`. Default 8. */
  maxAttempts?: number;
}

export type ReconcileSweepOutcome = 'success' | 'failed' | 'skipped';

export interface ReconcileSweepObservation {
  outcome: ReconcileSweepOutcome;
  durationSeconds: number;
}

export interface ReconcileExhaustedObservation {
  wagerId: string;
  attempts: number;
  failureReason: string;
}

export interface PvpObservabilityOptions {
  /** Called after each reconciliation sweep. Observer errors are ignored. */
  onReconcileSweep?: (observation: ReconcileSweepObservation) => void;
  /** Called once when a wager exhausts its settlement reconciliation attempts. */
  onReconcileExhausted?: (observation: ReconcileExhaustedObservation) => void;
export interface PvpObservabilityOptions {
  /** Called after each reconciliation sweep. Observer errors are ignored. */
  onReconcileSweep?: (observation: ReconcileSweepObservation) => void;
/**
 * Durable delivery of wager events through the `pvp_wager_events` outbox.
 *
 * Events are written in the same transaction as the status change, so a crash
 * between the commit and the handler cannot lose them: a background dispatcher
 * picks up undelivered rows and calls `onEvent` until it succeeds.
 */
export interface OutboxOptions {
  /** Run the outbox dispatcher. Default true. */
  enabled?: boolean;
  /** Seconds between dispatches. Default 5. */
  dispatcherIntervalSeconds?: number;
  /** Delivery attempts before a row is left for manual inspection. Default 10. */
  maxAttempts?: number;
  /** Base delay for exponential retry backoff, in milliseconds. Default 1,000. */
  backoffMs?: number;
  /** Upper bound on the retry backoff, in milliseconds. Default 300,000. */
  maxBackoffMs?: number;
}

export interface PvpSettlementOptions {
  mode: SettlementMode;
  /** Required when `mode` is `stellar`. */
  stellar?: StellarSettlementOptions;
  /** Enables the wallet-linking endpoints and `Sep10Service`. */
  sep10?: Sep10Options;
  /**
   * Identifies the player making an HTTP request, or returns `null` when the
   * request is not authenticated. The toolkit's controllers only act for the
   * player this returns; a player id is never read from a request body.
   */
  authenticate: (request: unknown) => Promise<string | null> | string | null;
  /** Ledgers until a pot times out and players may reclaim stakes. Default 17,280 (~1 day). */
  potTimeoutLedgers?: number;
  /** Seconds player two has to accept before the wager is cancelled. Default 900. */
  acceptWindowSeconds?: number;
  /** Seconds both players have to stake before the wager is refunded. Default 900. */
  stakeWindowSeconds?: number;
  reconcile?: ReconcileOptions;
  /** Optional hooks for a host application's metrics implementation. */
  observability?: PvpObservabilityOptions;
  /** Tuning for the durable event outbox. */
  outbox?: OutboxOptions;
  /**
   * Called for each wager status change, e.g. to notify players.
   *
   * Delivery is **at-least-once**: an event may be delivered more than once
   * (after a crash, a timeout, or a retry), so handlers must be idempotent —
   * key on the event id or the wager status rather than assuming a single call.
   * Errors thrown by the handler are logged and retried with backoff.
   */
  onEvent?: (event: PvpEvent) => void;
  /**
   * Also call `onEvent` synchronously right after the status change commits,
   * in addition to the outbox. Default false. Useful in tests that want the
   * event without waiting for a dispatch; production should leave it off so
   * handlers only run through the durable path.
   */
  synchronousEmit?: boolean;
  /** Mount the HTTP controllers. Default true. */
  controllers?: boolean;
}

export const DEFAULTS = {
  potTimeoutLedgers: 17_280,
  acceptWindowSeconds: 900,
  stakeWindowSeconds: 900,
  reconcileIntervalSeconds: 60,
  reconcileMinAgeSeconds: 60,
  reconcileMaxAttempts: 8,
  outboxDispatcherIntervalSeconds: 5,
  outboxMaxAttempts: 10,
  outboxBackoffMs: 1_000,
  outboxMaxBackoffMs: 300_000,
  challengeTtlSeconds: 300,
  stakeTxTimeoutSeconds: 300,
  confirmTimeoutSeconds: 30,
  httpTimeoutMs: 15_000,
} as const;

/**
 * Throws on a configuration that must never boot: stellar mode without its
 * settings, or custodial key handling on mainnet.
 */
export function validateOptions(options: PvpSettlementOptions): void {
  if (options.mode !== 'mock' && options.mode !== 'stellar') {
    throw new Error(`Unknown settlement mode "${String(options.mode)}"; use "mock" or "stellar"`);
  }
  if (options.mode === 'stellar') {
    const stellar = options.stellar;
    if (!stellar) {
      throw new Error('Settlement mode "stellar" needs the `stellar` options');
    }
    for (const key of ['rpcUrl', 'networkPassphrase', 'escrowContractId', 'tokenContractId'] as const) {
      if (!stellar[key]) {
        throw new Error(`Settlement mode "stellar" needs stellar.${key}`);
      }
    }
    if (!stellar.resolverSecret && !stellar.resolverSecretProvider) {
      throw new Error(
        'Settlement mode "stellar" needs stellar.resolverSecret or stellar.resolverSecretProvider',
      );
    }
    if (stellar.custodyMode === 'custodial' && stellar.network === 'public') {
      throw new Error(
        'Custodial mode is refused on the public network. Custodial key handling on mainnet ' +
          'needs an explicit, audited opt-in that this toolkit does not provide.',
      );
    }
  }
  if (options.sep10 && !options.sep10.signingSecret) {
    throw new Error('sep10.signingSecret is required when SEP-10 is enabled');
  }
  const timeout = options.potTimeoutLedgers ?? DEFAULTS.potTimeoutLedgers;
  if (timeout < 60 || timeout > 518_400) {
    throw new Error('potTimeoutLedgers must be between 60 and 518400, the contract limits');
  }
  const outbox = options.outbox;
  if (outbox) {
    const interval = outbox.dispatcherIntervalSeconds ?? DEFAULTS.outboxDispatcherIntervalSeconds;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error('outbox.dispatcherIntervalSeconds must be a positive number of seconds');
    }
    const maxAttempts = outbox.maxAttempts ?? DEFAULTS.outboxMaxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('outbox.maxAttempts must be a positive integer');
    }
    const backoffMs = outbox.backoffMs ?? DEFAULTS.outboxBackoffMs;
    if (!Number.isFinite(backoffMs) || backoffMs < 0) {
      throw new Error('outbox.backoffMs must be a non-negative number of milliseconds');
    }
    const maxBackoffMs = outbox.maxBackoffMs ?? DEFAULTS.outboxMaxBackoffMs;
    if (!Number.isFinite(maxBackoffMs) || maxBackoffMs < backoffMs) {
      throw new Error('outbox.maxBackoffMs must be a number no smaller than outbox.backoffMs');
    }
  }
  if (options.stellar) {
    const httpTimeoutMs = options.stellar.httpTimeoutMs ?? DEFAULTS.httpTimeoutMs;
    // A negative timeout is meaningless: it would cancel every request before
    // it was sent. `0` is the documented way to opt out, so it is allowed.
    if (!Number.isFinite(httpTimeoutMs) || httpTimeoutMs < 0) {
      throw new Error(
        `stellar.httpTimeoutMs must be a non-negative number of milliseconds (0 disables the ` +
          `timeout), got ${String(options.stellar.httpTimeoutMs)}`,
      );
    }
  }
}
