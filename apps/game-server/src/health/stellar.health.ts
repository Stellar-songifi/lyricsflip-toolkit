import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * Checks that the Stellar RPC endpoint is reachable when the server is
 * running in `stellar` settlement mode. Reports healthy (skipped) in `mock`
 * mode so the readiness probe does not fail on environments that don't use
 * Stellar settlement.
 */
@Injectable()
export class StellarHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService<AppConfig, true>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const stellar = this.config.get('stellar', { infer: true });

    if (stellar.settlementMode !== 'stellar') {
      return this.getStatus(key, true, { mode: 'mock', checked: false });
    }

    const rpcUrl = stellar.rpcUrl;
    try {
      const timeoutMs = stellar.httpTimeoutMs > 0 ? stellar.httpTimeoutMs : 10_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return this.getStatus(key, true, { rpcUrl });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(
        `Stellar RPC at ${rpcUrl} is unreachable: ${error}`,
        this.getStatus(key, false, { rpcUrl, error }),
      );
    }
  }
}
