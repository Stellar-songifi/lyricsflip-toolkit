import configuration from './configuration';

/**
 * Issue #8: the RPC timeout has to reach `SorobanRpc`, which is only possible
 * if the game server reads it out of the environment first. Kept in its own
 * file because `configuration.spec.ts` covers CORS and rounds.
 */
const REQUIRED = {
  JWT_SECRET: 'test-secret',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'lyricsflip',
};

describe('configuration: STELLAR_RPC_HTTP_TIMEOUT_MS', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
    delete process.env.STELLAR_RPC_HTTP_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = original;
  });

  it('defaults to 15 seconds when the variable is unset', () => {
    expect(configuration().stellar.httpTimeoutMs).toBe(15_000);
  });

  it('takes its value from the environment', () => {
    process.env.STELLAR_RPC_HTTP_TIMEOUT_MS = '3000';
    expect(configuration().stellar.httpTimeoutMs).toBe(3_000);
  });

  it('accepts 0 as the documented way to disable the timeout', () => {
    process.env.STELLAR_RPC_HTTP_TIMEOUT_MS = '0';
    expect(configuration().stellar.httpTimeoutMs).toBe(0);
  });

  it('parses the default without depending on the settlement mode', () => {
    process.env.STELLAR_SETTLEMENT_MODE = 'mock';
    expect(configuration().stellar.httpTimeoutMs).toBe(15_000);
    process.env.STELLAR_SETTLEMENT_MODE = 'stellar';
    process.env.STELLAR_ESCROW_CONTRACT_ID = 'CESCROW';
    process.env.STELLAR_TOKEN_CONTRACT_ID = 'CTOKEN';
    process.env.STELLAR_RESOLVER_SECRET = 'S'.padEnd(56, 'A');
    expect(configuration().stellar.httpTimeoutMs).toBe(15_000);
  });

  it('refuses a value that is not a non-negative number', () => {
    for (const bad of ['-1', 'soon', 'NaN', 'Infinity']) {
      process.env.STELLAR_RPC_HTTP_TIMEOUT_MS = bad;
      expect(() => configuration()).toThrow(
        /STELLAR_RPC_HTTP_TIMEOUT_MS must be a non-negative number/,
      );
    }
  });
});
