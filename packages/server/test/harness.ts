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
export async function createHarness(overrides: Partial<PvpSettlementOptions> = {}): Promise<Harness> {
  const schema = `pvp_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  const events: PvpEvent[] = [];
  const sep10Keypair = Keypair.random();
  const moduleRef = await Test.createTestingModule({
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
  })
    .overrideProvider(ESCROW_GATEWAY)
    .useFactory({
      factory: (mock: MockEscrowGateway) => new ScriptedGateway(mock),
      inject: [MockEscrowGateway],
    })
    .compile();

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

export const STAKE = '50000000';
