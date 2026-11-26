import { promises as fs } from 'fs';

/**
 * Where the game server reads the Stellar resolver secret from
 * (`STELLAR_RESOLVER_SECRET_SOURCE`, #68).
 *
 * - `env`: `STELLAR_RESOLVER_SECRET`, read once at boot. Rotating it needs a
 *   restart, and the toolkit warns about it outside local.
 * - `file`: a file (e.g. a Kubernetes-mounted secret) re-read on every call.
 * - `vault`: a HashiCorp Vault KV v2 secret, over Vault's HTTP API.
 * - `aws-secrets-manager`: an AWS Secrets Manager secret. Needs the optional
 *   `@aws-sdk/client-secrets-manager` package.
 *
 * Every source except `env` is passed to the toolkit as
 * `resolverSecretProvider`, which caches the value for
 * `STELLAR_RESOLVER_SECRET_CACHE_TTL_MS` and re-reads it after that, so a
 * rotation takes effect without a restart.
 */
export type ResolverSecretSource = 'env' | 'file' | 'vault' | 'aws-secrets-manager';

export const RESOLVER_SECRET_SOURCES: readonly ResolverSecretSource[] = [
  'env',
  'file',
  'vault',
  'aws-secrets-manager',
];

export type ResolverSecretConfig =
  | { source: 'env'; secret: string }
  | { source: 'file'; path: string }
  | { source: 'vault'; address: string; token: string; mount: string; path: string; field: string }
  | { source: 'aws-secrets-manager'; secretId: string; region?: string; jsonKey?: string };

/** A Stellar secret seed: `S` + 55 base32 characters. */
const SECRET_SEED = /^S[A-Z2-7]{55}$/;

function checkSeed(value: string, where: string): string {
  const secret = value.trim();
  if (!SECRET_SEED.test(secret)) {
    throw new Error(`${where} does not contain a Stellar secret seed (S...)`);
  }
  return secret;
}

/** Minimal client surface used for AWS, injectable in tests. */
export interface SecretsManagerLike {
  getSecretString(secretId: string): Promise<string | undefined>;
}

export interface ProviderDeps {
  fetch?: typeof fetch;
  secretsManager?: SecretsManagerLike;
}

/**
 * Returns a `resolverSecretProvider` for the configured source, or `null`
 * for `env` (the static secret is used as-is).
 */
export function resolverSecretProvider(
  config: ResolverSecretConfig,
  deps: ProviderDeps = {},
): (() => Promise<string>) | null {
  switch (config.source) {
    case 'env':
      return null;

    case 'file':
      return async () => checkSeed(await fs.readFile(config.path, 'utf8'), `File ${config.path}`);

    case 'vault': {
      const doFetch = deps.fetch ?? fetch;
      const url = `${config.address.replace(/\/$/, '')}/v1/${config.mount}/data/${config.path}`;
      return async () => {
        const res = await doFetch(url, { headers: { 'X-Vault-Token': config.token } });
        if (!res.ok) {
          throw new Error(`Vault returned ${res.status} for ${config.mount}/${config.path}`);
        }
        const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
        const value = body.data?.data?.[config.field];
        if (typeof value !== 'string') {
          throw new Error(`Vault secret ${config.mount}/${config.path} has no string field "${config.field}"`);
        }
        return checkSeed(value, `Vault secret ${config.mount}/${config.path}#${config.field}`);
      };
    }

    case 'aws-secrets-manager': {
      let client: Promise<SecretsManagerLike> | undefined = deps.secretsManager
        ? Promise.resolve(deps.secretsManager)
        : undefined;
      return async () => {
        client ??= awsSecretsManager(config.region);
        const raw = await (await client).getSecretString(config.secretId);
        if (!raw) throw new Error(`AWS secret ${config.secretId} has no SecretString`);
        let value = raw;
        if (config.jsonKey) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed[config.jsonKey] !== 'string') {
            throw new Error(`AWS secret ${config.secretId} has no string key "${config.jsonKey}"`);
          }
          value = parsed[config.jsonKey] as string;
        }
        return checkSeed(value, `AWS secret ${config.secretId}`);
      };
    }
  }
}

async function awsSecretsManager(region?: string): Promise<SecretsManagerLike> {
  let sdk: any;
  try {
    // Optional dependency: only needed when this source is selected.
    sdk = await import('@aws-sdk/client-secrets-manager' as string);
  } catch {
    throw new Error(
      'STELLAR_RESOLVER_SECRET_SOURCE=aws-secrets-manager needs the @aws-sdk/client-secrets-manager package',
    );
  }
  const client = new sdk.SecretsManagerClient(region ? { region } : {});
  return {
    async getSecretString(secretId: string) {
      const out = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretId }));
      return out.SecretString as string | undefined;
    },
  };
}

/** Reads the source's settings from the environment (see `.env.example`). */
export function resolverSecretConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ResolverSecretConfig {
  const source = (env.STELLAR_RESOLVER_SECRET_SOURCE ?? 'env') as ResolverSecretSource;
  const need = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`Missing required environment variable: ${key} (for ${source})`);
    return value;
  };
  switch (source) {
    case 'env':
      return { source, secret: need('STELLAR_RESOLVER_SECRET') };
    case 'file':
      return { source, path: need('STELLAR_RESOLVER_SECRET_FILE') };
    case 'vault':
      return {
        source,
        address: need('VAULT_ADDR'),
        token: need('VAULT_TOKEN'),
        mount: env.STELLAR_RESOLVER_SECRET_VAULT_MOUNT ?? 'secret',
        path: need('STELLAR_RESOLVER_SECRET_VAULT_PATH'),
        field: env.STELLAR_RESOLVER_SECRET_VAULT_FIELD ?? 'secret',
      };
    case 'aws-secrets-manager':
      return {
        source,
        secretId: need('STELLAR_RESOLVER_SECRET_AWS_ID'),
        region: env.AWS_REGION,
        jsonKey: env.STELLAR_RESOLVER_SECRET_AWS_JSON_KEY,
      };
    default:
      throw new Error(
        `STELLAR_RESOLVER_SECRET_SOURCE must be one of ${RESOLVER_SECRET_SOURCES.join(', ')} (got "${source}")`,
      );
  }
}
