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
