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
