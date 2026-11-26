import { Controller, Get, Inject, NotFoundException, UseGuards } from '@nestjs/common';
import { ESCROW_GATEWAY, EscrowGateway } from '../escrow/escrow.gateway';
import { PvpPlayerGuard } from './player.guard';
import { ResolverAddressDto } from './response.dto';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from './swagger';

/**
 * Ops route: reports the resolver public key the live server is signing with,
 * so an operator can confirm it matches the on-chain resolver before and after
 * a rotation (`set_resolver` on the contract). A mismatch means the rotation
 * has not fully landed yet.
 *
 * Behind the same guard as every other toolkit route, so it is not public. The
 * value itself is public data — it is readable on-chain through `get_config` —
 * so this exposes no secret; the guard exists to keep the surface internal.
 */
@ApiTags('wager')
@ApiBearerAuth()
@Controller('wager')
@UseGuards(PvpPlayerGuard)
export class ResolverController {
  constructor(@Inject(ESCROW_GATEWAY) private readonly gateway: EscrowGateway) {}

  @ApiOperation({ summary: 'The resolver public key the server signs with' })
  @ApiOkResponse({ type: ResolverAddressDto })
  @ApiNotFoundResponse({ description: 'This settlement mode has no resolver key.' })
  @Get('resolver-address')
  async resolverAddress(): Promise<{ resolverAddress: string }> {
    if (!this.gateway.currentResolverAddress) {
      throw new NotFoundException('This settlement mode signs nothing with a resolver key');
    }
    return { resolverAddress: await this.gateway.currentResolverAddress() };
  }
}
