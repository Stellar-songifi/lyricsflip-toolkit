import { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { AppConfig } from '../../config/configuration';

/** One JWT configuration for the auth module and the settlement module. */
export function jwtModuleOptions(configService: ConfigService<AppConfig, true>): JwtModuleOptions {
  const jwtConfig = configService.get('jwt', { infer: true });
  return {
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn as JwtSignOptions['expiresIn'] },
  };
}

/** Pulls a bearer token out of an HTTP request, or `null`. */
export function bearerToken(request: { headers?: Record<string, unknown> }): string | null {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Reads the `exp` claim (seconds since epoch) from a decoded JWT payload.
 * Returns `null` when the claim is missing or not a finite number.
 */
export function tokenExpiry(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const exp = (payload as { exp?: unknown }).exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

/** True when the token's `exp` (seconds) has already passed. */
export function isTokenExpired(exp: number | null, nowMs: number = Date.now()): boolean {
  if (exp === null) return true;
  return exp * 1000 <= nowMs;
}
