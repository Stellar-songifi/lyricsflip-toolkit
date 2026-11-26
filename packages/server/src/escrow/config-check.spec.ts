import { Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { StellarSettlementOptions } from '../options';
import { StellarEscrowGateway } from './stellar-escrow.gateway';

const TOKEN = 'CTOKEN';

function gateway(resolver: Keypair, extra: Partial<StellarSettlementOptions> = {}) {
  return new StellarEscrowGateway({
    mode: 'stellar',
    authenticate: () => null,
    stellar: {
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      escrowContractId: 'CESCROW',
      tokenContractId: TOKEN,
      resolverSecret: resolver.secret(),
      ...extra,
    },
  });
}

describe('StellarEscrowGateway boot-time contract check (#58)', () => {
  const resolver = Keypair.random();
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  function onChain(g: StellarEscrowGateway, overrides: Partial<{ resolver: string; token: string }> = {}) {
    return jest.spyOn(g.client, 'getConfig').mockResolvedValue({
      admin: 'GADMINMULTISIG',
      resolver: resolver.publicKey(),
      token: TOKEN,
      ...overrides,
    } as any);
  }

  it('boots when the contract matches, and logs the admin', async () => {
    const g = gateway(resolver);
    onChain(g);
    await expect(g.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(' ')).toContain('admin GADMINMULTISIG');
  });

  it('refuses to boot when the on-chain resolver differs', async () => {
    const g = gateway(resolver);
    const other = Keypair.random().publicKey();
    onChain(g, { resolver: other });
    await expect(g.onApplicationBootstrap()).rejects.toThrow(
      `its resolver is ${other}, but this server signs as ${resolver.publicKey()}`,
    );
  });

  it('refuses to boot when the token differs', async () => {
    const g = gateway(resolver);
    onChain(g, { token: 'COTHERTOKEN' });
    await expect(g.onApplicationBootstrap()).rejects.toThrow('its token is COTHERTOKEN, but tokenContractId is CTOKEN');
  });

  it('refuses to boot when the contract id is not a pvp-escrow deployment', async () => {
    const g = gateway(resolver);
    jest.spyOn(g.client, 'getConfig').mockRejectedValue(new Error('MissingValue'));
    await expect(g.onApplicationBootstrap()).rejects.toThrow('get_config failed (MissingValue)');
  });

  it('only warns with configCheck "warn"', async () => {
    const g = gateway(resolver, { configCheck: 'warn' });
    onChain(g, { resolver: Keypair.random().publicKey() });
    await expect(g.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toContain('does not match this server');
  });

  it('skips the check with configCheck "off"', async () => {
    const g = gateway(resolver, { configCheck: 'off' });
    const getConfig = jest.spyOn(g.client, 'getConfig');
    await g.onApplicationBootstrap();
    expect(getConfig).not.toHaveBeenCalled();
  });
});
