import { validateEnvironment } from './environment';

describe('environment validation', () => {
  it('reports every missing required variable in one error', () => {
    let message = '';
    try {
      validateEnvironment({ NODE_ENV: 'test' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Invalid environment configuration:');
    for (const key of [
      'JWT_SECRET',
      'DB_HOST',
      'DB_PORT',
      'DB_USERNAME',
      'DB_PASSWORD',
      'DB_NAME',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('aggregates independent invalid values instead of failing on the first one', () => {
    expect(() =>
      validateEnvironment({
        JWT_SECRET: 'test-secret',
        DB_HOST: 'localhost',
        DB_PORT: 'not-a-port',
        DB_USERNAME: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'lyricsflip',
        ROUNDS_PER_SESSION: '0',
        STELLAR_SETTLEMENT_MODE: 'unsafe',
      }),
    ).toThrow(/DB_PORT[\s\S]*ROUNDS_PER_SESSION[\s\S]*STELLAR_SETTLEMENT_MODE/);
  });

  it('validates the frontend URL when it is used as the production CORS fallback', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_SECRET: 'test-secret',
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USERNAME: 'postgres',
        DB_PASSWORD: 'postgres',
        DB_NAME: 'lyricsflip',
        FRONTEND_URL: '*',
        SEP10_SIGNING_SECRET: 'sep10-secret',
      }),
    ).toThrow(/CORS_ORIGIN/);
  });
});
