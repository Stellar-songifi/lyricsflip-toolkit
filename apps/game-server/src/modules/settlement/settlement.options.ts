import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Keypair } from '@stellar/stellar-sdk';
import type { PvpSettlementOptions } from '@lyricsflip-toolkit/server';
import { AppConfig } from '../../config/configuration';
import { bearerToken } from '../auth/jwt.config';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

const logger = new Logger('Settlement');

/**
 * Builds the toolkit's options from the game server's config:
 * - players are identified by the game's own JWT;
 * - every wager status change is re-emitted as `pvp.<type>` on the event bus.
 */
export function settlementOptions(
  config: ConfigService<AppConfig, true>,
  jwt: JwtService,
  events: EventEmitter2,
): PvpSettlementOptions {
  const stellar = config.get('stellar', { infer: true });
  const sep10 = config.get('sep10', { infer: true });

  let signingSecret = sep10.signingSecret;
  if (!signingSecret) {
    logger.warn(
      'SEP10_SIGNING_SECRET is not set; using a throwaway key. Logins break on restart. ' +
        'Set it before running more than one instance.',
    );
    signingSecret = Keypair.random().secret();
  }

  return {
    mode: stellar.settlementMode,
    stellar:
      stellar.settlementMode === 'stellar'
        ? {
            network: stellar.network,
            rpcUrl: stellar.rpcUrl,
            networkPassphrase: stellar.networkPassphrase,
            escrowContractId: stellar.escrowContractId,
            tokenContractId: stellar.tokenContractId,
            resolverSecret: stellar.resolverSecret,
            custodyMode: stellar.custodyMode,
            httpTimeoutMs: stellar.httpTimeoutMs,
          }
        : undefined,
    sep10: {
      signingSecret,
      homeDomain: sep10.homeDomain,
      networkPassphrase: stellar.networkPassphrase,
    },
    authenticate: (request: unknown) => {
      const token = bearerToken(request as { headers?: Record<string, unknown> });
      if (!token) return null;
      try {
        return jwt.verify<JwtPayload>(token).sub;
      } catch {
        return null;
      }
    },
    onEvent: (event) => {
      events.emit(`pvp.${event.type}`, event);
    },
  };
}
