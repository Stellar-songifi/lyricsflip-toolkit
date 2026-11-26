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
  /**
   * Seconds a player has to answer each card before the round closes.
   * `ROUND_SECONDS`, default 20. A session can override it via
   * `CreateSessionOptions.roundSeconds`.
   */
  roundSeconds: number;
  /** Browser origin allowed by CORS (the web game). Native apps don't need it. */
  corsOrigin: string | null;
  /**
   * Whether the Swagger UI at `/api/docs` is served. `SWAGGER_ENABLED`,
   * default `true` outside production and `false` in production.
   */
  swaggerEnabled: boolean;
   * Express `trust proxy` setting. Behind a load balancer this must be set so
   * rate limiting sees the real client IP. `TRUST_PROXY`, default `false`.
   */
  trustProxy: boolean | number | string;
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

/** Placeholder shipped in `.env.example`; never valid as a real secret. */
const EXAMPLE_JWT_SECRET = 'change-me-in-production';
/** Minimum secret length in bytes; shorter secrets are brute-forceable. */
const MIN_JWT_SECRET_BYTES = 32;

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Rejects weak or default JWT secrets. In production a bad secret is fatal
 * (a public secret lets anyone forge tokens for any user id); elsewhere it is
 * only a warning so local development stays frictionless.
 */
function validateJwtSecret(secret: string, nodeEnv: string): void {
  const problems: string[] = [];
  if (secret === EXAMPLE_JWT_SECRET) {
    problems.push('it is the .env.example placeholder value');
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    problems.push(`it is shorter than ${MIN_JWT_SECRET_BYTES} bytes`);
  }
  if (problems.length === 0) {
    return;
  }

  const detail = `JWT_SECRET is weak: ${problems.join(' and ')}. Generate one with \`openssl rand -base64 48\`.`;
  if (nodeEnv === 'production') {
    throw new Error(detail);
  }
  // eslint-disable-next-line no-console
  console.warn(`[config] ${detail}`);
 * Parses `TRUST_PROXY` into an Express `trust proxy` value.
 * Accepts `true`/`false`, a hop count (`1`), or a comma-separated list of
 * trusted subnets/addresses (e.g. `loopback,10.0.0.0/8`).
 */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === '') {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return trimmed;
}

/**
 * Parses `CORS_ORIGIN` into the list of allowed browser origins.
 * Accepts a single origin or a comma-separated list. `*` is only honoured
 * outside production (production refuses it below).
 */
function parseCorsOrigins(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
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

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const corsOrigin = process.env.CORS_ORIGIN ?? process.env.FRONTEND_URL ?? null;

  if (nodeEnv === 'production' && (!corsOrigin || corsOrigin === '*')) {
    throw new Error('CORS_ORIGIN must be explicitly set to a specific origin in production mode');
  }

  // Publishing the full API surface is a deliberate choice, so Swagger is off
  // by default in production and on everywhere else.
  const swaggerEnabled =
    (process.env.SWAGGER_ENABLED ?? (nodeEnv === 'production' ? 'false' : 'true')) === 'true';
  const jwtSecret = required('JWT_SECRET');
  validateJwtSecret(jwtSecret, nodeEnv);

  const hasReplica = Boolean(process.env.DB_REPLICA_HOST);

  const rawRounds = process.env.ROUNDS_PER_SESSION ?? '10';
  const roundsPerSession = Number(rawRounds);
  if (!Number.isInteger(roundsPerSession) || roundsPerSession < 1) {
    throw new Error(`ROUNDS_PER_SESSION must be a positive integer, got "${rawRounds}"`);
  }

  const rawRoundSeconds = process.env.ROUND_SECONDS ?? '20';
  const roundSeconds = Number(rawRoundSeconds);
  if (!Number.isInteger(roundSeconds) || roundSeconds < 1) {
    throw new Error(`ROUND_SECONDS must be a positive integer, got "${rawRoundSeconds}"`);
  }

  const rawHttpTimeoutMs = process.env.STELLAR_RPC_HTTP_TIMEOUT_MS ?? '15000';
  const httpTimeoutMs = Number(rawHttpTimeoutMs);
  // A hung RPC node must not hold the request handler open, so the timeout has
  // to be a real, non-negative number of milliseconds. `0` opts out.
  if (!Number.isFinite(httpTimeoutMs) || httpTimeoutMs < 0) {
    throw new Error(
      `STELLAR_RPC_HTTP_TIMEOUT_MS must be a non-negative number of milliseconds ` +
        `(0 disables the timeout), got "${rawHttpTimeoutMs}"`,
    );
  }

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv,
    roundsPerSession,
    roundSeconds,
    corsOrigin,
    swaggerEnabled,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    jwt: {
      secret: jwtSecret,
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
      httpTimeoutMs,
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

export { parseCorsOrigins };
