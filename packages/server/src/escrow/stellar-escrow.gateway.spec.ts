import { Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { PvpSettlementOptions, StellarSettlementOptions } from '../options';
import { StellarEscrowGateway } from './stellar-escrow.gateway';

const TTL_MS = 60_000;

function makeOptions(stellar: Partial<StellarSettlementOptions>): PvpSettlementOptions {
  return {
    mode: 'stellar',
    authenticate: () => null,
    stellar: {
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      escrowContractId: 'CESCROW',
      tokenContractId: 'CTOKEN',
      ...stellar,
    },
  };
}

function submission() {
  return { status: 'confirmed' as const, hash: 'hash', ledger: 7 };
}

const OPEN_POT = {
  potId: 'pot-1',
  playerA: 'GA',
  playerB: 'GB',
  stakeAmount: '500',
  timeoutLedgers: 100,
};

describe('StellarEscrowGateway resolver key', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('static secret (unchanged behaviour)', () => {
    it('signs with it and reports it without a provider', async () => {
      const key = Keypair.random();
      const gateway = new StellarEscrowGateway(makeOptions({ resolverSecret: key.secret() }));
      const openPot = jest.spyOn(gateway.client, 'openPot').mockResolvedValue(submission());
      jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);

      await gateway.openPot(OPEN_POT);

      expect(openPot.mock.calls[0][0].publicKey()).toBe(key.publicKey());
      expect(gateway.resolverAddress).toBe(key.publicKey());
      expect(await gateway.currentResolverAddress()).toBe(key.publicKey());
    });

    it('warns at startup off local, and not on local', () => {
      const key = Keypair.random();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      new StellarEscrowGateway(makeOptions({ resolverSecret: key.secret(), network: 'testnet' }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('static resolverSecret'));

      warn.mockClear();
      new StellarEscrowGateway(makeOptions({ resolverSecret: key.secret(), network: 'local' }));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('resolverSecretProvider (hot rotation)', () => {
    it('re-reads before each resolver call, so a rotation mid-test takes effect', async () => {
      const first = Keypair.random();
      const second = Keypair.random();
      let currentSecret = first.secret();
      const provider = jest.fn(async () => currentSecret);

      const gateway = new StellarEscrowGateway(
        makeOptions({ resolverSecretProvider: provider, resolverSecretCacheTtlMs: TTL_MS }),
      );
      const openPot = jest.spyOn(gateway.client, 'openPot').mockResolvedValue(submission());
      const resolve = jest.spyOn(gateway.client, 'resolve').mockResolvedValue(submission());
      const refund = jest.spyOn(gateway.client, 'refund').mockResolvedValue(submission());
      jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);

      await gateway.openPot(OPEN_POT);
      expect(openPot.mock.calls[0][0].publicKey()).toBe(first.publicKey());

      // The operator rotates the resolver key while the server is running.
      currentSecret = second.secret();
      now += TTL_MS;

      await gateway.resolve('pot-1', 'GA');
      await gateway.refund('pot-1');

      expect(resolve.mock.calls[0][0].publicKey()).toBe(second.publicKey());
      expect(refund.mock.calls[0][0].publicKey()).toBe(second.publicKey());
      expect(await gateway.currentResolverAddress()).toBe(second.publicKey());
    });

    it('caches within the TTL, so a burst of pot operations reads the manager once', async () => {
      const key = Keypair.random();
      const provider = jest.fn(async () => key.secret());

      const gateway = new StellarEscrowGateway(
        makeOptions({ resolverSecretProvider: provider, resolverSecretCacheTtlMs: TTL_MS }),
      );
      jest.spyOn(gateway.client, 'openPot').mockResolvedValue(submission());
      jest.spyOn(gateway.client, 'resolve').mockResolvedValue(submission());
      jest.spyOn(gateway.client, 'refund').mockResolvedValue(submission());
      jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);

      await gateway.openPot(OPEN_POT);
      await gateway.resolve('pot-1', 'GA');
      await gateway.refund('pot-1');

      expect(provider).toHaveBeenCalledTimes(1);
    });

    it('does not warn about a static secret when a provider is configured', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      new StellarEscrowGateway(
        makeOptions({ resolverSecretProvider: async () => Keypair.random().secret() }),
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('reports a provider failure as a failed submission instead of throwing', async () => {
      const gateway = new StellarEscrowGateway(
        makeOptions({
          resolverSecretProvider: async () => {
            throw new Error('vault sealed');
          },
        }),
      );
      jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);

      await expect(gateway.refund('pot-1')).resolves.toMatchObject({
        status: 'failed',
        error: 'vault sealed',
      });
    });
  });
});

describe('StellarEscrowGateway RPC HTTP timeout (Issue #8)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const key = Keypair.random();

  it('defaults the SDK to a 15 second HTTP timeout', () => {
    const gateway = new StellarEscrowGateway(makeOptions({ resolverSecret: key.secret() }));

    expect(gateway.client.rpc.httpTimeoutMs).toBe(15_000);
    expect(gateway.client.rpc.server.httpClient.defaults.timeout).toBe(15_000);
  });

  it('passes a configured httpTimeoutMs down to the SDK', () => {
    const gateway = new StellarEscrowGateway(
      makeOptions({ resolverSecret: key.secret(), httpTimeoutMs: 2_500 }),
    );

    expect(gateway.client.rpc.httpTimeoutMs).toBe(2_500);
    expect(gateway.client.rpc.server.httpClient.defaults.timeout).toBe(2_500);
  });

  it('reports an openPot that timed out as pending, so the wager stays reconcilable', async () => {
    const gateway = new StellarEscrowGateway(
      makeOptions({ resolverSecret: key.secret(), httpTimeoutMs: 1_000 }),
    );
    jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);
    jest
      .spyOn(gateway.client, 'openPot')
      .mockResolvedValue({ status: 'pending', hash: 'hash', error: 'timeout of 1000 ms exceeded' });

    // `pending` is what keeps the wager out of a terminal state: it is not
    // confirmed, but nothing proves the network refused it either, so the
    // background reconciler has to settle it. `failed` would strand it.
    await expect(gateway.openPot(OPEN_POT)).resolves.toMatchObject({ status: 'pending' });
  });

  it('does not report a timed-out resolver call as a failed submission', async () => {
    const gateway = new StellarEscrowGateway(
      makeOptions({ resolverSecret: key.secret(), httpTimeoutMs: 1_000 }),
    );

    // `submit` classifies a thrown sendTransaction as `pending`; the gateway
    // must preserve that rather than downgrading it to `failed`.
    const submission = { status: 'pending' as const, hash: 'hash', error: 'timeout' };
    jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);
    jest.spyOn(gateway.client, 'openPot').mockResolvedValue(submission);

    const outcome = await gateway.openPot(OPEN_POT);

    expect(outcome.status).not.toBe('failed');
    expect(outcome.status).toBe('pending');
    expect(outcome.txHash).toBe('hash');
  });

  it('still reports a genuine pre-submission failure as failed', async () => {
    const gateway = new StellarEscrowGateway(
      makeOptions({ resolverSecret: key.secret(), httpTimeoutMs: 1_000 }),
    );

    // A build/simulation timeout happens before anything is submitted, so
    // `failed` is correct here and the wager may be failed outright.
    jest.spyOn(gateway.client, 'getPot').mockResolvedValue(null);
    jest.spyOn(gateway.client, 'openPot').mockRejectedValue(new Error('timeout of 1000 ms exceeded'));

    await expect(gateway.openPot(OPEN_POT)).resolves.toMatchObject({
      status: 'failed',
      error: 'timeout of 1000 ms exceeded',
    });
  });
});
