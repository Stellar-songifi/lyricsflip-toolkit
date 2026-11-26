import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { WagerService } from '../wager/wager.service';
import { SubmitStakeAuthDto, SubmitStakeDto } from './dto';
import { StakeTransactionDto, UnsignedStakeAuthDto, WagerDto } from './response.dto';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags, ApiUnauthorizedResponse } from './swagger';
import { PlayerId, PvpPlayerGuard } from './player.guard';

/**
 * Player-facing wager routes. There is deliberately no route to settle,
 * refund or create a wager: the game server does those through
 * `WagerService`, because only it knows who joined and who won.
 */
@ApiTags('wagers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'No signed-in player.' })
@Controller('wagers')
@UseGuards(PvpPlayerGuard)
export class WagerController {
  constructor(private readonly wagers: WagerService) {}

  @ApiOperation({ summary: "List the signed-in player's wagers" })
  @ApiOkResponse({ type: WagerDto, isArray: true })
  @Get()
  list(@PlayerId() playerId: string) {
    return this.wagers.listForPlayer(playerId);
  }

  @ApiOperation({ summary: "Get one of the player's wagers" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.getForPlayer(id, playerId);
  }

  @ApiOperation({ summary: 'Accept a wager you were invited to' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.accept(id, playerId);
  }

  @ApiOperation({ summary: 'Decline a wager you were invited to' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Post(':id/decline')
  @HttpCode(200)
  decline(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.decline(id, playerId);
  }

  @ApiOperation({ summary: 'Cancel a wager you proposed' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.cancel(id, playerId);
  }

  /** `{ transaction: null }` means no signature is needed: post to `/stake` directly. */
  @ApiOperation({ summary: 'Build the stake transaction for your wallet to sign' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: StakeTransactionDto })
  @ApiNotFoundResponse()
  @Post(':id/stake-transaction')
  @HttpCode(200)
  async stakeTransaction(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return { transaction: await this.wagers.buildStakeTransaction(id, playerId) };
  }

  @ApiOperation({ summary: 'Submit your stake (the signed transaction, or nothing in mock mode)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @Post(':id/stake')
  @HttpCode(200)
  stake(
    @Param('id', ParseUUIDPipe) id: string,
    @PlayerId() playerId: string,
    @Body() dto: SubmitStakeDto,
  ) {
    return this.wagers.submitStake(id, playerId, dto.signedTransactionXdr ?? null);
  }

  @ApiOperation({ summary: 'Smart wallets: get the stake authorisation entry to sign (the server relays it)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UnsignedStakeAuthDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Post(':id/stake-auth')
  @HttpCode(200)
  stakeAuth(@Param('id', ParseUUIDPipe) id: string, @PlayerId() playerId: string) {
    return this.wagers.buildStakeAuth(id, playerId);
  }

  @ApiOperation({ summary: 'Smart wallets: submit the signed stake authorisation entry' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: WagerDto })
  @ApiNotFoundResponse()
  @ApiBadRequestResponse()
  @Post(':id/stake-auth/submit')
  @HttpCode(200)
  submitStakeAuth(
    @Param('id', ParseUUIDPipe) id: string,
    @PlayerId() playerId: string,
    @Body() dto: SubmitStakeAuthDto,
  ) {
    return this.wagers.submitStakeAuth(id, playerId, dto.signedAuthEntryXdr);
  }
}
