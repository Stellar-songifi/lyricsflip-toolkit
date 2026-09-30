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
