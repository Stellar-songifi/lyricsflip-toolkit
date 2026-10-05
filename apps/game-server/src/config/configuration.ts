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
  corsOrigin: string;
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

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export default (): AppConfig => {
  const settlementMode = (process.env.STELLAR_SETTLEMENT_MODE ?? 'mock') as SettlementMode;
  const custodyMode = (process.env.STELLAR_CUSTODY_MODE ?? 'non-custodial') as CustodyMode;
  const network = process.env.STELLAR_NETWORK ?? 'testnet';

  if (settlementMode !== 'mock' && settlementMode !== 'stellar') {
    throw new Error(`STELLAR_SETTLEMENT_MODE must be "mock" or "stellar", got "${settlementMode}"`);
  }
  if (custodyMode === 'custodial' && network === 'public') {
    throw new Error(
      'STELLAR_CUSTODY_MODE=custodial is refused when STELLAR_NETWORK=public. ' +
        'Custodial key handling on mainnet needs an explicit, audited opt-in.',
    );
  }

  const hasReplica = Boolean(process.env.DB_REPLICA_HOST);

  const rawRounds = process.env.ROUNDS_PER_SESSION ?? '10';
  const roundsPerSession = Number(rawRounds);
  if (!Number.isInteger(roundsPerSession) || roundsPerSession < 1) {
    throw new Error(`ROUNDS_PER_SESSION must be a positive integer, got "${rawRounds}"`);
  }

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    roundsPerSession,
    corsOrigin: process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? 'http://localhost:3000',
    jwt: {
      secret: required('JWT_SECRET'),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    },
    database: {
      primary: {
        host: required('DB_HOST'),
        port: parseInt(required('DB_PORT'), 10),
        username: required('DB_USERNAME'),
        password: required('DB_PASSWORD'),
        name: required('DB_NAME'),
      },
      replica: hasReplica
        ? {
            host: process.env.DB_REPLICA_HOST as string,
            port: parseInt(process.env.DB_REPLICA_PORT ?? process.env.DB_PORT ?? '5432', 10),
            username: process.env.DB_REPLICA_USERNAME ?? required('DB_USERNAME'),
            password: process.env.DB_REPLICA_PASSWORD ?? required('DB_PASSWORD'),
            name: process.env.DB_REPLICA_NAME ?? required('DB_NAME'),
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
        settlementMode === 'stellar' ? required('STELLAR_ESCROW_CONTRACT_ID') : '',
      tokenContractId: settlementMode === 'stellar' ? required('STELLAR_TOKEN_CONTRACT_ID') : '',
      resolverSecret: settlementMode === 'stellar' ? required('STELLAR_RESOLVER_SECRET') : '',
    },
    faucet: {
      secret: network === 'public' ? '' : (process.env.FAUCET_SECRET ?? ''),
      asset: process.env.STELLAR_STAKE_ASSET ?? '',
      amount: process.env.FAUCET_AMOUNT ?? '100',
    },
    push: {
      enabled:
        (process.env.EXPO_PUSH_ENABLED ?? ((process.env.NODE_ENV ?? 'development') === 'production' ? 'true' : 'false')) ===
        'true',
      accessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
    },
    sep10: {
      // Must be stable across restarts and shared by every instance, or
      // pending logins break. Only optional outside production.
      signingSecret:
        (process.env.NODE_ENV ?? 'development') === 'production'
          ? required('SEP10_SIGNING_SECRET')
          : (process.env.SEP10_SIGNING_SECRET ?? ''),
      homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'localhost',
    },
  };
};
