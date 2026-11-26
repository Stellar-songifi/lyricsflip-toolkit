import { Keypair } from '@stellar/stellar-sdk';
import { StellarEscrowGateway } from '@lyricsflip-toolkit/server';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolverSecretConfigFromEnv, resolverSecretProvider } from './resolver-secret.source';

const TTL_MS = 30_000;

function gatewayFor(provider: () => Promise<string>) {
  return new StellarEscrowGateway({
    mode: 'stellar',
    authenticate: () => null,
    stellar: {
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      escrowContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      tokenContractId: 'CTOKEN',
      resolverSecretProvider: provider,
      resolverSecretCacheTtlMs: TTL_MS,
    },
  });
}

describe('resolver secret sources (#68)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('file: a rotated key takes effect within the cache TTL, without a restart', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const dir = mkdtempSync(join(tmpdir(), 'resolver-'));
    const file = join(dir, 'resolver-secret');
    const oldKey = Keypair.random();
    const newKey = Keypair.random();
    writeFileSync(file, `${oldKey.secret()}\n`);

    const provider = resolverSecretProvider(resolverSecretConfigFromEnv({
      STELLAR_RESOLVER_SECRET_SOURCE: 'file',
      STELLAR_RESOLVER_SECRET_FILE: file,
    }));
    const gateway = gatewayFor(provider!);
    expect(await gateway.currentResolverAddress()).toBe(oldKey.publicKey());

    writeFileSync(file, newKey.secret());
    now += TTL_MS - 1;
    expect(await gateway.currentResolverAddress()).toBe(oldKey.publicKey()); // still cached

    now += 2;
    expect(await gateway.currentResolverAddress()).toBe(newKey.publicKey());
  });

  it('file: refuses a file that does not hold a secret seed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolver-'));
    const file = join(dir, 'resolver-secret');
    writeFileSync(file, Keypair.random().publicKey());
    const provider = resolverSecretProvider({ source: 'file', path: file })!;
    await expect(provider()).rejects.toThrow('does not contain a Stellar secret seed');
  });

  it('vault: reads the field from a KV v2 secret with the token', async () => {
    const key = Keypair.random();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { data: { secret: key.secret() } } }),
    });
    const provider = resolverSecretProvider(
      { source: 'vault', address: 'https://vault.test/', token: 't0k', mount: 'secret', path: 'lyricsflip/resolver', field: 'secret' },
      { fetch: fetchMock as unknown as typeof fetch },
    )!;

    expect(await provider()).toBe(key.secret());
    expect(fetchMock).toHaveBeenCalledWith('https://vault.test/v1/secret/data/lyricsflip/resolver', {
      headers: { 'X-Vault-Token': 't0k' },
    });
  });

  it('vault: surfaces an HTTP error', async () => {
    const provider = resolverSecretProvider(
      { source: 'vault', address: 'https://vault.test', token: 't', mount: 'secret', path: 'p', field: 'secret' },
      { fetch: (async () => ({ ok: false, status: 403 })) as unknown as typeof fetch },
    )!;
    await expect(provider()).rejects.toThrow('Vault returned 403');
  });

  it('aws-secrets-manager: reads a plain or JSON secret', async () => {
    const key = Keypair.random();
    const plain = resolverSecretProvider(
      { source: 'aws-secrets-manager', secretId: 'resolver' },
      { secretsManager: { getSecretString: async () => key.secret() } },
    )!;
    expect(await plain()).toBe(key.secret());

    const json = resolverSecretProvider(
      { source: 'aws-secrets-manager', secretId: 'resolver', jsonKey: 'seed' },
      { secretsManager: { getSecretString: async () => JSON.stringify({ seed: key.secret() }) } },
    )!;
    expect(await json()).toBe(key.secret());
  });

  it('reads each source from the environment and rejects unknown ones', () => {
    expect(resolverSecretConfigFromEnv({ STELLAR_RESOLVER_SECRET: 'S1' })).toEqual({ source: 'env', secret: 'S1' });
    expect(() => resolverSecretConfigFromEnv({ STELLAR_RESOLVER_SECRET_SOURCE: 'file' })).toThrow(
      'STELLAR_RESOLVER_SECRET_FILE',
    );
    expect(() => resolverSecretConfigFromEnv({ STELLAR_RESOLVER_SECRET_SOURCE: 'gcp' })).toThrow('must be one of');
    expect(resolverSecretProvider({ source: 'env', secret: 'S1' })).toBeNull();
  });
});
