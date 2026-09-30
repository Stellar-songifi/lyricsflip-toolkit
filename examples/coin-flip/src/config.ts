import { Keypair, Networks } from '@stellar/stellar-sdk';
import type { PvpSettlementOptions } from '@lyricsflip-toolkit/server';

const mode = (process.env.STELLAR_SETTLEMENT_MODE ?? 'mock') as 'mock' | 'stellar';
const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/coin_flip',
  /** Optional Postgres schema (used by the tests to isolate runs). */
  databaseSchema: process.env.DATABASE_SCHEMA,
  port: Number(process.env.PORT ?? 3002),
  tokenSecret: process.env.TOKEN_SECRET ?? 'dev-only-token-secret',
  settlementMode: mode,
  stellar:
    mode === 'stellar'
      ? ({
          network: process.env.STELLAR_NETWORK ?? 'testnet',
          rpcUrl: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
          networkPassphrase: passphrase,
          escrowContractId: process.env.STELLAR_ESCROW_CONTRACT_ID ?? '',
          tokenContractId: process.env.STELLAR_TOKEN_CONTRACT_ID ?? '',
          resolverSecret: process.env.STELLAR_RESOLVER_SECRET ?? '',
        } satisfies PvpSettlementOptions['stellar'])
      : undefined,
  sep10: {
    signingSecret: process.env.SEP10_SIGNING_SECRET ?? Keypair.random().secret(),
    homeDomain: process.env.SEP10_HOME_DOMAIN ?? 'localhost',
    networkPassphrase: passphrase,
  },
};
