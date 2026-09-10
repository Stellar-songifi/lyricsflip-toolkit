import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WagerService } from './wager.service';
import { CreateWagerDto } from './dto/create-wager.dto';

@ApiTags('wager')
@Controller('wagers')
export class WagerController {
  constructor(private readonly wagerService: WagerService) {}

  @Post()
  create(@Body() dto: CreateWagerDto) {
    return this.wagerService.createWager(
      dto.gameSessionId,
      dto.playerAId,
      dto.playerBId,
      dto.stakeAmount,
    );
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.wagerService.findById(id);
  }

  @Post(':id/stake')
  markStaked(@Param('id') id: string, @Body('playerId') playerId: string) {
    return this.wagerService.markPlayerStaked(id, playerId);
  }

  @Post(':id/settle')
  settle(@Param('id') id: string, @Body('winnerId') winnerId: string) {
    return this.wagerService.settle(id, winnerId);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.wagerService.refund(id);
  }

  /** Admin-only in a real deployment — gate this behind an admin guard. */
  @Post(':id/reconcile')
  reconcile(
    @Param('id') id: string,
    @Body('txHash') txHash: string,
    @Body('outcome') outcome: 'won' | 'refunded',
  ) {
    return this.wagerService.reconcile(id, txHash, outcome);
  }
}
