import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Keypair } from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import {
  ESCROW_GATEWAY,
  EscrowGateway,
  MockEscrowGateway,
  OpenPotParams,
  PVP_ENTITIES,
  PVP_MIGRATIONS,
  PvpEvent,
  PvpSettlementModule,
  PvpSettlementOptions,
  SubmitOutcome,
  WagerService,
  WalletLinkService,
} from '../src';

export const DATABASE_URL =
  process.env.PVP_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lyricsflip_test';

export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * How the scripted gateway should misbehave on the next call to a method:
 * - `lose`: do the call, but report `pending` (the process "crashed" before
 *   it saw the receipt).
 * - `drop`: don't do the call, and report `pending` (it never landed).
 * - `fail`: don't do the call, and report `failed`.
 */
export type Fault = 'lose' | 'drop' | 'fail';
type Method = 'openPot' | 'submitStake' | 'resolve' | 'refund';

/** Wraps the mock gateway so tests can inject unknown outcomes. */
export class ScriptedGateway implements EscrowGateway {
  readonly mode = 'mock' as const;
  private readonly faults = new Map<Method, Fault[]>();
  readonly calls: Method[] = [];

  constructor(readonly inner: MockEscrowGateway) {}

  /** Clears queued faults and the call log. */
  reset(): void {
    this.faults.clear();
    this.calls.length = 0;
  }

  inject(method: Method, ...faults: Fault[]): void {
    this.faults.set(method, [...(this.faults.get(method) ?? []), ...faults]);
  }

  private async run<T extends SubmitOutcome>(method: Method, call: () => Promise<T>): Promise<T | SubmitOutcome> {
    this.calls.push(method);
    const fault = this.faults.get(method)?.shift();
    if (fault === 'drop') return { status: 'pending', txHash: `dropped:${randomUUID()}` };
    if (fault === 'fail') return { status: 'failed', txHash: null, error: 'injected failure' };
    const outcome = await call();
    if (fault === 'lose') return { status: 'pending', txHash: outcome.txHash };
    return outcome;
  }

  openPot(params: OpenPotParams) {
    return this.run('openPot', () => this.inner.openPot(params));
  }
  buildStake() {
    return this.inner.buildStake();
  }
  submitStake(potId: string, player: string) {
    return this.run('submitStake', () => this.inner.submitStake(potId, player));
  }
  resolve(potId: string, winner: string) {
    return this.run('resolve', () => this.inner.resolve(potId, winner));
  }
  refund(potId: string) {
    return this.run('refund', () => this.inner.refund(potId));
  }
  getPot(potId: string) {
    return this.inner.getPot(potId);
  }
}

export interface Harness {
  app: INestApplication;
  wagers: WagerService;
  links: WalletLinkService;
  /** The fault-injecting mock gateway (only when `scripted`). */
  gateway: ScriptedGateway;
  dataSource: DataSource;
  events: PvpEvent[];
  sep10Keypair: Keypair;
  close(): Promise<void>;
}

/**
 * Boots the module against a fresh Postgres schema, in mock mode, with
 * players authenticated by an `x-player` header.
 */
export async function createHarness(
  overrides: Partial<PvpSettlementOptions> = {},
  { scripted = true, schema: providedSchema }: { scripted?: boolean; schema?: string } = {},
): Promise<Harness> {
  const schema = providedSchema ?? `pvp_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const events: PvpEvent[] = [];
  const sep10Keypair = Keypair.random();
  const builder = Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: DATABASE_URL,
        entities: PVP_ENTITIES,
        migrations: PVP_MIGRATIONS,
        migrationsRun: true,
        extra: { options: `-c search_path=${schema}` },
      }),
      PvpSettlementModule.forRoot({
        mode: 'mock',
        authenticate: (req: any) => req.headers['x-player'] ?? null,
        reconcile: { enabled: false },
        sep10: {
          signingSecret: sep10Keypair.secret(),
          homeDomain: 'toolkit.test',
          networkPassphrase: NETWORK_PASSPHRASE,
        },
        onEvent: (event) => events.push(event),
        ...overrides,
      }),
    ],
  });
  const moduleRef = await (scripted
    ? builder.overrideProvider(ESCROW_GATEWAY).useFactory({
        factory: (mock: MockEscrowGateway) => new ScriptedGateway(mock),
        inject: [MockEscrowGateway],
      })
    : builder
  ).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();

  const dataSource = app.get(DataSource);
  return {
    app,
    wagers: app.get(WagerService),
    links: app.get(WalletLinkService),
    gateway: app.get(ESCROW_GATEWAY),
    dataSource,
    events,
    sep10Keypair,
    async close() {
      await app.close();
      const cleanup = new Client({ connectionString: DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      await cleanup.end();
    },
  };
}

/** Two players with linked wallets. */
export async function twoLinkedPlayers(h: Harness) {
  const alice = { id: `alice-${randomUUID()}`, address: Keypair.random().publicKey() };
  const bob = { id: `bob-${randomUUID()}`, address: Keypair.random().publicKey() };
  await h.links.link(alice.id, alice.address);
  await h.links.link(bob.id, bob.address);
  return { alice, bob };
}

/**
 * Fires several `link` calls for the same player concurrently and returns the
 * settled results (never rejects). Useful for asserting that concurrent
 * verifies don't produce a `500` and leave exactly one valid link.
 */
export async function linkConcurrently(
  h: Harness,
  playerId: string,
  addresses: string[],
): Promise<PromiseSettledResult<unknown>[]> {
  return Promise.allSettled(addresses.map((address) => h.links.link(playerId, address)));
}

/**
 * Installs a temporary trigger on `pvp_wallet_links` that makes any INSERT or
 * UPDATE fail, so a test can assert that a failed save leaves the previous
 * link row intact. Returns a function that removes the trigger again.
 */
export async function failWalletLinkWrites(h: Harness): Promise<() => Promise<void>> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const fnName = `fail_wallet_link_write_${suffix}`;
  const triggerName = `fail_wallet_link_write_${suffix}`;
  await h.dataSource.query(`
    CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected wallet link write failure';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await h.dataSource.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT OR UPDATE ON pvp_wallet_links
    FOR EACH ROW EXECUTE FUNCTION ${fnName}();
  `);
  return async () => {
    await h.dataSource.query(`DROP TRIGGER IF EXISTS ${triggerName} ON pvp_wallet_links`);
    await h.dataSource.query(`DROP FUNCTION IF EXISTS ${fnName}()`);
  };
}

/**
 * Reads the raw wallet link rows for a player directly from the database, so
 * tests can assert on row counts and preserved addresses.
 */
export async function walletLinkRows(
  h: Harness,
  playerId: string,
): Promise<Array<{ playerId: string; address: string }>> {
  const rows = await h.dataSource.query(
    `SELECT "playerId", "address" FROM pvp_wallet_links WHERE "playerId" = $1`,
    [playerId],
  );
  return rows.map((row: any) => ({ playerId: row.playerId, address: row.address }));
}

export const STAKE = '50000000';