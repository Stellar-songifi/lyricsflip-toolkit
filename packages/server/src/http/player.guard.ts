import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { PVP_SETTLEMENT_OPTIONS, PvpSettlementOptions } from '../options';

const PLAYER_ID = Symbol('pvpPlayerId');

/**
 * Authenticates a request with the host app's `authenticate` option and
 * stores the player id for {@link PlayerId}. Every toolkit route acts only
 * for this player.
 */
@Injectable()
export class PvpPlayerGuard implements CanActivate {
  constructor(@Inject(PVP_SETTLEMENT_OPTIONS) private readonly options: PvpSettlementOptions) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const playerId = await this.options.authenticate(request);
    if (!playerId) {
      throw new UnauthorizedException();
    }
    request[PLAYER_ID] = playerId;
    return true;
  }
}

/** The authenticated player's id, set by {@link PvpPlayerGuard}. */
export const PlayerId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest()[PLAYER_ID];
});
