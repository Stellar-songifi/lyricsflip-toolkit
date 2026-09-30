import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { WagerService } from '../wager/wager.service';
import { SubmitStakeDto } from './dto';
import { PlayerId, PvpPlayerGuard } from './player.guard';

/**
 * Player-facing wager routes. There is deliberately no route to settle,
 * refund or create a wager: the game server does those through
 * `WagerService`, because only it knows who joined and who won.
 */
@Controller('wagers')
@UseGuards(PvpPlayerGuard)
export class WagerController {
  constructor(private readonly wagers: WagerService) {}

  @Get()
  list(@PlayerId() playerId: string) {
    return this.wagers.listForPlayer(playerId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.getForPlayer(id, playerId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.accept(id, playerId);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.decline(id, playerId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.cancel(id, playerId);
  }

  /** `{ transaction: null }` means no signature is needed: post to `/stake` directly. */
  @Post(':id/stake-transaction')
  @HttpCode(200)
  async stakeTransaction(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return { transaction: await this.wagers.buildStakeTransaction(id, playerId) };
  }

  @Post(':id/stake')
  @HttpCode(200)
  stake(
    @Param('id', ParseUUIDPipe) id: string,
    @PlayerId() playerId: string,
    @Body() dto: SubmitStakeDto,
  ) {
    return this.wagers.submitStake(id, playerId, dto.signedTransactionXdr ?? null);
  }
}
