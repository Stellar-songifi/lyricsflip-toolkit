import { databaseConnectionOptions } from './database-options';

describe('TypeORM CLI configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails loudly instead of targeting a default database when env is absent', () => {
    process.env = { NODE_ENV: 'test' };

    expect(() => databaseConnectionOptions()).toThrow(
      /Invalid environment configuration:[\s\S]*DB_HOST[\s\S]*DB_NAME/,
    );
  });

  it('returns the validated database values without fallback substitutions', () => {
    process.env = {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret',
      DB_HOST: 'db.internal',
      DB_PORT: '6543',
      DB_USERNAME: 'migration-user',
      DB_PASSWORD: 'migration-password',
      DB_NAME: 'lyricsflip-production',
    };

    expect(databaseConnectionOptions()).toEqual({
      host: 'db.internal',
      port: 6543,
      username: 'migration-user',
      password: 'migration-password',
      database: 'lyricsflip-production',
    });
  });
});
