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
  /** Secret key (S...) of the escrow's resolver. Keep it in a secrets manager. */
  resolverSecret: string;
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
    for (const key of ['rpcUrl', 'networkPassphrase', 'escrowContractId', 'tokenContractId', 'resolverSecret'] as const) {
      if (!stellar[key]) {
        throw new Error(`Settlement mode "stellar" needs stellar.${key}`);
      }
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
}
