import { PvpSettlementOptions, validateOptions } from './options';

const stellar = {
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  escrowContractId: 'C1',
  tokenContractId: 'C2',
  resolverSecret: 'S1',
};

function options(overrides: Partial<PvpSettlementOptions>): PvpSettlementOptions {
  return { mode: 'mock', authenticate: () => null, ...overrides };
}

describe('validateOptions', () => {
  it('accepts mock mode with no Stellar settings', () => {
    expect(() => validateOptions(options({}))).not.toThrow();
  });

  it('rejects unknown modes', () => {
    expect(() => validateOptions(options({ mode: 'live' as never }))).toThrow(/Unknown settlement mode/);
  });

  it('requires every Stellar setting in stellar mode', () => {
    expect(() => validateOptions(options({ mode: 'stellar' }))).toThrow(/needs the `stellar` options/);
    expect(() =>
      validateOptions(options({ mode: 'stellar', stellar: { ...stellar, resolverSecret: '' } })),
    ).toThrow(/stellar.resolverSecret/);
    expect(() => validateOptions(options({ mode: 'stellar', stellar }))).not.toThrow();
  });

  it('refuses custodial mode on the public network', () => {
    expect(() =>
      validateOptions(
        options({ mode: 'stellar', stellar: { ...stellar, network: 'public', custodyMode: 'custodial' } }),
      ),
    ).toThrow(/Custodial mode is refused on the public network/);
    expect(() =>
      validateOptions(
        options({ mode: 'stellar', stellar: { ...stellar, network: 'testnet', custodyMode: 'custodial' } }),
      ),
    ).not.toThrow();
  });

  it('keeps pot timeouts inside the contract limits', () => {
    expect(() => validateOptions(options({ potTimeoutLedgers: 59 }))).toThrow(/potTimeoutLedgers/);
    expect(() => validateOptions(options({ potTimeoutLedgers: 518_401 }))).toThrow(/potTimeoutLedgers/);
  });
});
