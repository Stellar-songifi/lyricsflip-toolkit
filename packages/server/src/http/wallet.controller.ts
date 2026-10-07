import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Sep10Service } from '../wallet/sep10.service';
import { WalletLinkService } from '../wallet/wallet-link.service';
import { WalletChallengeDto, WalletVerifyDto } from './dto';
import { PlayerId, PvpPlayerGuard } from './player.guard';

/** Links the signed-in player's account to a wallet they prove they own. */
@Controller('wallet')
@UseGuards(PvpPlayerGuard)
export class WalletController {
  constructor(
    private readonly sep10: Sep10Service,
    private readonly links: WalletLinkService,
  ) {}

  @Get()
  async get(@PlayerId() playerId: string) {
    return { address: await this.links.getAddress(playerId) };
  }

  @Post('challenge')
  @HttpCode(200)
  challenge(@Body() dto: WalletChallengeDto) {
    return this.sep10.buildChallenge(dto.address);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@PlayerId() playerId: string, @Body() dto: WalletVerifyDto) {
    const address = await this.sep10.verify(dto.address, dto.signedTransactionXdr);
    const link = await this.links.link(playerId, address);
    return { address: link.address, verifiedAt: link.verifiedAt };
  }
}
