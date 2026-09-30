// Loaded by jest before any test module, so config and the data source see it.
const url = new URL(
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lyricsflip_e2e',
);
process.env.DB_HOST = url.hostname;
process.env.DB_PORT = url.port || '5432';
process.env.DB_USERNAME = decodeURIComponent(url.username);
process.env.DB_PASSWORD = decodeURIComponent(url.password);
process.env.DB_NAME = url.pathname.slice(1);
process.env.JWT_SECRET = 'e2e-only-jwt-secret';
process.env.STELLAR_SETTLEMENT_MODE = 'mock';
process.env.STELLAR_NETWORK = 'testnet';
process.env.SEP10_HOME_DOMAIN = 'lyricsflip.test';
process.env.NODE_ENV = 'test';
