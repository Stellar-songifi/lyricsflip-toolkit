import { validateEnvironment } from './environment';

export type SettlementMode = 'mock' | 'stellar';
export type CustodyMode = 'non-custodial' | 'custodial';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  /**
   * Rounds in a session, unless the creator overrides it per session.
   * `ROUNDS_PER_SESSION`, default 10.
   */
  roundsPerSession: number;
  /** Browser origin allowed by CORS (the web game). Native apps don't need it. */
  corsOrigin: string | null;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  database: {
    primary: {
      host: string;
      port: number;
      username: string;
      password: string;
      name: string;
    };
    replica: {
      host: string;
      port: number;
      username: string;
      password: string;
      name: string;
    } | null;
  };
  stellar: {
    settlementMode: SettlementMode;
    custodyMode: CustodyMode;
    network: string;
    rpcUrl: string;
    networkPassphrase: string;
    escrowContractId: string;
    tokenContractId: string;
    resolverSecret: string;
    /** Per-request HTTP timeout for RPC calls, in ms. `0` disables it. */
    httpTimeoutMs: number;
  };
  faucet: {
    /** Secret of the account that holds the test stake token. Test networks only. */
    secret: string;
    /** `CODE:ISSUER` of the stake token's classic asset. */
    asset: string;
    /** Display amount sent per claim, e.g. `100`. */
    amount: string;
  };
  push: {
    /** Deliver through Expo. Off by default outside production. */
    enabled: boolean;
    /** Optional Expo access token, if push security is enabled for the project. */
    accessToken: string;
  };
  sep10: {
    /** Empty in development means "generate a throwaway key at boot". */
    signingSecret: string;
    homeDomain: string;
  };
}

export default (): AppConfig => {
  const env = validateEnvironment(process.env);
  const settlementMode = (env.STELLAR_SETTLEMENT_MODE ?? 'mock') as SettlementMode;
  const custodyMode = (env.STELLAR_CUSTODY_MODE ?? 'non-custodial') as CustodyMode;
  const network = env.STELLAR_NETWORK ?? 'testnet';
  const nodeEnv = env.NODE_ENV ?? 'development';
  const corsOrigin = env.CORS_ORIGIN ?? env.FRONTEND_URL ?? null;

  const hasReplica = Boolean(process.env.DB_REPLICA_HOST);

  const roundsPerSession = env.ROUNDS_PER_SESSION ?? 10;
  const httpTimeoutMs = env.STELLAR_RPC_HTTP_TIMEOUT_MS ?? 15_000;

  return {
    port: env.PORT ?? 3001,
    nodeEnv,
    roundsPerSession,
    corsOrigin,
    jwt: {
      secret: env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    },
    database: {
      primary: {
        host: env.DB_HOST,
        port: env.DB_PORT,
        username: env.DB_USERNAME,
        password: env.DB_PASSWORD,
        name: env.DB_NAME,
      },
      replica: hasReplica
        ? {
            host: process.env.DB_REPLICA_HOST as string,
            port: parseInt(process.env.DB_REPLICA_PORT ?? process.env.DB_PORT ?? '5432', 10),
            username: process.env.DB_REPLICA_USERNAME ?? env.DB_USERNAME,
            password: process.env.DB_REPLICA_PASSWORD ?? env.DB_PASSWORD,
            name: process.env.DB_REPLICA_NAME ?? env.DB_NAME,
          }
        : null,
    },
    stellar: {
      settlementMode,
      custodyMode,
      network,
      rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
      networkPassphrase:
        process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
      escrowContractId:
        settlementMode === 'stellar' ? (env.STELLAR_ESCROW_CONTRACT_ID as string) : '',
      tokenContractId:
        settlementMode === 'stellar' ? (env.STELLAR_TOKEN_CONTRACT_ID as string) : '',
      resolverSecret: settlementMode === 'stellar' ? (env.STELLAR_RESOLVER_SECRET as string) : '',
      httpTimeoutMs,
    },
    faucet: {
      secret: network === 'public' ? '' : (process.env.FAUCET_SECRET ?? ''),
      asset: process.env.STELLAR_STAKE_ASSET ?? '',
      amount: process.env.FAUCET_AMOUNT ?? '100',
    },
    push: {
      enabled:
        (process.env.EXPO_PUSH_ENABLED ??
          ((process.env.NODE_ENV ?? 'development') === 'production' ? 'true' : 'false')) === 'true',
      accessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
    },
    sep10: {
      // Must be stable across restarts and shared by every instance, or
      // pending logins break. Only optional outside production.
      signingSecret:
        (process.env.NODE_ENV ?? 'development') === 'production'
          ? (env.SEP10_SIGNING_SECRET as string)
          : (process.env.SEP10_SIGNING_SECRET ?? ''),
      homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'localhost',
    },
  };
};
