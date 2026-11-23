import { configuration } from './configuration';

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
