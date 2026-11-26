import { configuration } from './configuration';

describe('configuration: JWT_SECRET', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original, ...REQUIRED };
    process.env.CORS_ORIGIN = 'https://app.example.com';
  });

  afterAll(() => {
    process.env = original;
  });

  it('refuses the example placeholder value in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';

    expect(() => configuration()).toThrow(/JWT_SECRET/);
  });

  it('refuses a secret shorter than 32 bytes in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';

    expect(() => configuration()).toThrow(/JWT_SECRET/);
  });

  it('accepts a valid secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(48);

    const config = configuration();
    expect(config.jwtSecret).toBe('a'.repeat(48));
  });
});

describe('configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('swaggerEnabled', () => {
    it('defaults to true outside production', () => {
      process.env = { ...originalEnv, NODE_ENV: 'development' };
      delete process.env.SWAGGER_ENABLED;

      expect(configuration().swaggerEnabled).toBe(true);
    });

    it('defaults to false in production', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      delete process.env.SWAGGER_ENABLED;

      expect(configuration().swaggerEnabled).toBe(false);
    });

    it('honours an explicit SWAGGER_ENABLED=true in production', () => {
      process.env = {
        ...originalEnv,
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'true',
      };

      expect(configuration().swaggerEnabled).toBe(true);
    });

    it('honours an explicit SWAGGER_ENABLED=false outside production', () => {
      process.env = {
        ...originalEnv,
        NODE_ENV: 'development',
        SWAGGER_ENABLED: 'false',
      };

      expect(configuration().swaggerEnabled).toBe(false);
    });
  });
});
