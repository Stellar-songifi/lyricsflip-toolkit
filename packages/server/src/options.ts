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
  /**
   * What to do at boot when the contract at `escrowContractId` doesn't match
   * this server (#58): its `get_config` must answer, its resolver must be the
   * key this server signs with, and its token must be `tokenContractId`.
   * - `fail` (default): refuse to boot.
   * - `warn`: log and boot anyway, e.g. while a resolver rotation is in flight.
   * - `off`: skip the check.
   */
  configCheck?: 'fail' | 'warn' | 'off';
  /**
   * Secret (S...) of a fee account that pays players' stake fees through a
   * fee-bump (#60), so players need the stake token but no XLM for fees.
   * Optional; without it players pay their own fees.
   */
  feeSponsorSecret?: string;
  /** Limits on fee sponsorship. */
  feeSponsorship?: FeeSponsorshipOptions;
}

export interface FeeSponsorshipOptions {
  /** Most a single sponsored stake may cost, in stroops. Default 10,000,000 (1 XLM). */
  maxFeePerStakeStroops?: number | bigint;
  /** Most all sponsored stakes may cost per UTC day, in stroops. Default 1,000,000,000 (100 XLM). */
  dailyBudgetStroops?: number | bigint;
  /** Sponsored stakes per player per UTC day. Default 20. */
  maxStakesPerPlayerPerDay?: number;
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

/**
 * SEP-45 web auth for contract accounts (`C...`, e.g. passkey wallets), #61.
 * Uses `sep10`'s signing key, home domain and network passphrase. The signing
 * key's account must **exist on the network** (it needs no balance beyond the
 * reserve): the web auth contract checks the server's authorisation, and
 * Soroban can only verify a `G...` signer that has an account.
 */
export interface Sep45Options {
  /** The deployed SEP-45 web auth contract (`WEB_AUTH_CONTRACT_ID`). */
  webAuthContractId: string;
  /** Soroban RPC used to simulate the challenge. */
  rpcUrl: string;
  /** Ledgers a challenge, and the wallet's signature, stay valid. Default 60 (~5 min). */
  challengeLedgers?: number;
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

export interface PvpSettlementOptions {
  mode: SettlementMode;
  /** Required when `mode` is `stellar`. */
  stellar?: StellarSettlementOptions;
  /** Enables the wallet-linking endpoints and `Sep10Service`. */
  sep10?: Sep10Options;
  /** Enables wallet linking for contract accounts through SEP-45. Needs `sep10`. */
  sep45?: Sep45Options;
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
  /**
   * Called after each wager status change, e.g. to notify players. Runs
   * after the change is committed; errors are logged and swallowed.
   */
  onEvent?: (event: PvpEvent) => void;
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
  if (options.sep45 && !options.sep10) {
    throw new Error('sep45 needs sep10 (its signing key, home domain and network passphrase)');
  }
  if (options.sep45 && (!options.sep45.webAuthContractId || !options.sep45.rpcUrl)) {
    throw new Error('sep45 needs webAuthContractId and rpcUrl');
  }
  if (options.sep10 && !options.sep10.signingSecret) {
    throw new Error('sep10.signingSecret is required when SEP-10 is enabled');
  }
  const timeout = options.potTimeoutLedgers ?? DEFAULTS.potTimeoutLedgers;
  if (timeout < 60 || timeout > 518_400) {
    throw new Error('potTimeoutLedgers must be between 60 and 518400, the contract limits');
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
