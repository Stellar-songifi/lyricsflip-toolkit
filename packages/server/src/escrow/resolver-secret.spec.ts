import { Keypair } from '@stellar/stellar-sdk';
import { DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS, ResolverKeyProvider } from './resolver-secret';

describe('ResolverKeyProvider', () => {
  const T0 = 1_000_000;
  let now: number;
  let log: { log: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    now = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    log = { log: jest.fn(), warn: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  it('requires a static secret or a provider', () => {
    expect(() => new ResolverKeyProvider({}, log)).toThrow(
      /resolver secret or a resolverSecretProvider/,
    );
  });

  describe('with a static secret', () => {
    it('parses it once, is known immediately, and never changes', async () => {
      const key = Keypair.random();
      const keys = new ResolverKeyProvider({ resolverSecret: key.secret() }, log);

      expect(keys.rotates).toBe(false);
      // Known without awaiting: the static secret is parsed in the constructor.
      expect(keys.lastKnownAddress).toBe(key.publicKey());

      expect((await keys.resolve()).publicKey()).toBe(key.publicKey());
      now += 10 * DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS;
      expect((await keys.resolve()).publicKey()).toBe(key.publicKey());
      expect(log.log).not.toHaveBeenCalled();
    });
  });

  describe('with a provider', () => {
    it('reads through it, caches for the TTL, and then picks up a rotation', async () => {
      const first = Keypair.random();
      const second = Keypair.random();
      const provider = jest.fn(async () => first.secret());
      const keys = new ResolverKeyProvider({ resolverSecretProvider: provider }, log);

      expect(keys.rotates).toBe(true);
      expect(keys.lastKnownAddress).toBeNull();

      expect((await keys.resolve()).publicKey()).toBe(first.publicKey());
      expect(keys.lastKnownAddress).toBe(first.publicKey());

      // Still inside the TTL: served from cache, provider untouched.
      now += DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS - 1;
      expect((await keys.resolve()).publicKey()).toBe(first.publicKey());
      expect(provider).toHaveBeenCalledTimes(1);

      // The operator rotates the key in the secrets manager mid-test.
      provider.mockImplementation(async () => second.secret());
      now += 1;
      expect((await keys.resolve()).publicKey()).toBe(second.publicKey());
      expect(provider).toHaveBeenCalledTimes(2);
      expect(keys.lastKnownAddress).toBe(second.publicKey());
      expect(log.log).toHaveBeenCalledWith(expect.stringContaining('rotated'));
    });

    it('honours a custom TTL', async () => {
      const provider = jest.fn(async () => Keypair.random().secret());
      const keys = new ResolverKeyProvider(
        { resolverSecretProvider: provider, resolverSecretCacheTtlMs: 5 },
        log,
      );

      await keys.resolve();
      now += 4;
      await keys.resolve();
      expect(provider).toHaveBeenCalledTimes(1);

      now += 1;
      await keys.resolve();
      expect(provider).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent readers onto one provider call', async () => {
      const key = Keypair.random();
      let release!: (secret: string) => void;
      const gate = new Promise<string>((resolve) => {
        release = resolve;
      });
      const provider = jest.fn(() => gate);
      const keys = new ResolverKeyProvider({ resolverSecretProvider: provider }, log);

      const all = Promise.all([keys.resolve(), keys.resolve(), keys.resolve()]);
      release(key.secret());
      const resolved = await all;

      expect(provider).toHaveBeenCalledTimes(1);
      expect(resolved.map((k) => k.publicKey())).toEqual([
        key.publicKey(),
        key.publicKey(),
        key.publicKey(),
      ]);
    });

    it('does not cache a failure, so the next call retries', async () => {
      const key = Keypair.random();
      const provider = jest
        .fn<Promise<string>, []>()
        .mockRejectedValueOnce(new Error('secrets manager down'))
        .mockResolvedValueOnce(key.secret());
      const keys = new ResolverKeyProvider({ resolverSecretProvider: provider }, log);

      await expect(keys.resolve()).rejects.toThrow('secrets manager down');
      expect(keys.lastKnownAddress).toBeNull();

      expect((await keys.resolve()).publicKey()).toBe(key.publicKey());
      expect(provider).toHaveBeenCalledTimes(2);
    });

    it('rejects a provider that returns no secret', async () => {
      const keys = new ResolverKeyProvider({ resolverSecretProvider: async () => '' }, log);
      await expect(keys.resolve()).rejects.toThrow(/empty secret/);
    });

    it('invalidate() forces an immediate re-read', async () => {
      const provider = jest.fn(async () => Keypair.random().secret());
      const keys = new ResolverKeyProvider({ resolverSecretProvider: provider }, log);

      await keys.resolve();
      await keys.resolve();
      expect(provider).toHaveBeenCalledTimes(1);

      keys.invalidate();
      await keys.resolve();
      expect(provider).toHaveBeenCalledTimes(2);
    });
  });
});
