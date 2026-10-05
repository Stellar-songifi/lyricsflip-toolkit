import { Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';

/** Default trust window for a `resolverSecretProvider` result: 60 seconds. */
export const DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS = 60_000;

/** Where the resolver secret comes from: a static value, or a hot-rotatable provider. */
export interface ResolverSecretSource {
  /** Static secret (S...). Used as-is when `resolverSecretProvider` is absent. */
  resolverSecret?: string;
  /** Called to re-read the secret; results are cached for the TTL below. */
  resolverSecretProvider?: () => Promise<string>;
  /** How long a provider result is trusted. Default {@link DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS}. */
  resolverSecretCacheTtlMs?: number;
}

/**
 * Supplies the escrow's resolver `Keypair`, re-reading it through
 * `resolverSecretProvider` at most once per `resolverSecretCacheTtlMs`.
 *
 * With a static `resolverSecret` the keypair is parsed once and never changes —
 * the original behaviour, kept for callers that have no secrets manager. With a
 * provider, rotating the key in the secrets manager takes effect within one
 * TTL, with no restart, so the window in which the server signs with a
 * compromised key is bounded by the TTL rather than by the process lifetime.
 *
 * Concurrent callers share one provider read, so a burst of pot operations
 * after the TTL expires does not stampede the secrets manager.
 */
export class ResolverKeyProvider {
  private readonly staticKeypair: Keypair | null;
  private cached: Keypair | null = null;
  private cachedAt = 0;
  private pending: Promise<Keypair> | null = null;

  constructor(
    private readonly source: ResolverSecretSource,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger(ResolverKeyProvider.name),
  ) {
    if (!source.resolverSecret && !source.resolverSecretProvider) {
      throw new Error('A resolver secret or a resolverSecretProvider is required');
    }
    this.staticKeypair = source.resolverSecret ? Keypair.fromSecret(source.resolverSecret) : null;
  }

  /** How long a provider result is trusted. */
  get cacheTtlMs(): number {
    return this.source.resolverSecretCacheTtlMs ?? DEFAULT_RESOLVER_SECRET_CACHE_TTL_MS;
  }

  /** True when the key can change while the process runs. */
  get rotates(): boolean {
    return Boolean(this.source.resolverSecretProvider);
  }

  /** The address seen most recently, or `null` before the first provider read. */
  get lastKnownAddress(): string | null {
    return (this.cached ?? this.staticKeypair)?.publicKey() ?? null;
  }

  /**
   * The keypair to sign with right now. With a provider this re-reads once the
   * TTL has passed, so a rotation is picked up without a restart.
   */
  async resolve(): Promise<Keypair> {
    if (!this.source.resolverSecretProvider) {
      // Non-null: the constructor requires a secret or a provider.
      return this.staticKeypair as Keypair;
    }
    if (this.cached && Date.now() - this.cachedAt < this.cacheTtlMs) {
      return this.cached;
    }
    this.pending ??= this.read().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Drops the cache, so the next {@link resolve} re-reads. A failure is never
   * cached, so this is only needed to force an immediate re-read.
   */
  invalidate(): void {
    this.cached = null;
    this.cachedAt = 0;
  }

  private async read(): Promise<Keypair> {
    const secret = await this.source.resolverSecretProvider!();
    if (!secret) {
      throw new Error('resolverSecretProvider returned an empty secret');
    }
    const keypair = Keypair.fromSecret(secret);
    // Read before overwriting, so a change of address is visible as a rotation.
    const previous = this.lastKnownAddress;
    this.cached = keypair;
    this.cachedAt = Date.now();
    if (previous && previous !== keypair.publicKey()) {
      this.logger.log(`Resolver key rotated: ${previous} -> ${keypair.publicKey()}`);
    }
    return keypair;
  }
}
