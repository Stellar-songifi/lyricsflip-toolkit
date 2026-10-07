import configuration from './configuration';

/** The variables `required()` insists on, so the loader can run under test. */
const REQUIRED = {
  JWT_SECRET: 'test-secret',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'lyricsflip',
};

describe('configuration: ROUNDS_PER_SESSION', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
    delete process.env.ROUNDS_PER_SESSION;
  });

  afterAll(() => {
    process.env = original;
  });

  it('defaults to 10 when the variable is unset', () => {
    expect(configuration().roundsPerSession).toBe(10);
  });

  it('takes its value from the environment', () => {
    process.env.ROUNDS_PER_SESSION = '3';
    expect(configuration().roundsPerSession).toBe(3);
  });

  it('refuses a value that is not a positive integer', () => {
    for (const bad of ['0', '-2', 'lots', '2.5', '']) {
      process.env.ROUNDS_PER_SESSION = bad;
      expect(() => configuration()).toThrow(/ROUNDS_PER_SESSION must be a positive integer/);
    }
  });
});

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Provide baseline required env vars so we isolate CORS testing
    process.env.JWT_SECRET = 'test-secret';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USERNAME = 'postgres';
    process.env.DB_PASSWORD = 'postgres';
    process.env.DB_NAME = 'test_db';
    process.env.STELLAR_SETTLEMENT_MODE = 'mock';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults corsOrigin to null when unset outside production', () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_URL;
    process.env.NODE_ENV = 'development';

    const config = configuration();
    expect(config.corsOrigin).toBeNull();
  });

  it('uses CORS_ORIGIN if provided', () => {
    process.env.CORS_ORIGIN = 'https://myapp.example.com';
    process.env.NODE_ENV = 'development';

    const config = configuration();
    expect(config.corsOrigin).toBe('https://myapp.example.com');
  });

  it('falls back to FRONTEND_URL if CORS_ORIGIN is unset', () => {
    delete process.env.CORS_ORIGIN;
    process.env.FRONTEND_URL = 'https://frontend.example.com';
    process.env.NODE_ENV = 'development';

    const config = configuration();
    expect(config.corsOrigin).toBe('https://frontend.example.com');
  });

  it('throws an error at startup when NODE_ENV is production and CORS_ORIGIN is unset', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_URL;
    process.env.SEP10_SIGNING_SECRET = 'test-signing-secret';

    expect(() => configuration()).toThrow(
      'CORS_ORIGIN must be explicitly set to a specific origin in production mode',
    );
  });

  it('throws an error at startup when NODE_ENV is production and CORS_ORIGIN is wildcard *', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '*';
    process.env.SEP10_SIGNING_SECRET = 'test-signing-secret';

    expect(() => configuration()).toThrow(
      'CORS_ORIGIN must be explicitly set to a specific origin in production mode',
    );
  });

  it('succeeds in production when CORS_ORIGIN is explicitly set to a specific origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example.com';
    process.env.SEP10_SIGNING_SECRET = 'test-signing-secret';

    const config = configuration();
    expect(config.corsOrigin).toBe('https://app.example.com');
  });
});
