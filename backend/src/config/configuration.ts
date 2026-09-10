export type SettlementMode = 'mock' | 'stellar';
export type CustodyMode = 'non-custodial' | 'custodial';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  frontendUrl: string;
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

  if (custodyMode === 'custodial' && network === 'public') {
    throw new Error(
      'STELLAR_CUSTODY_MODE=custodial is refused when STELLAR_NETWORK=public. ' +
        'Custodial key handling on mainnet needs an explicit, audited opt-in.',
    );
  }

  const hasReplica = Boolean(process.env.DB_REPLICA_HOST);

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
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
  };
};
