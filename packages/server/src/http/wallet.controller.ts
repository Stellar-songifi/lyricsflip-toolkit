import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import { Sep10Service } from '../wallet/sep10.service';
import { Sep45Service } from '../wallet/sep45.service';
import { WalletLinkService } from '../wallet/wallet-link.service';
import { WalletChallengeDto, WalletVerifyDto } from './dto';
import { PlayerId, PvpPlayerGuard } from './player.guard';

/** Links the signed-in player's account to a wallet they prove they own. */
@Controller('wallet')
@UseGuards(PvpPlayerGuard)
export class WalletController {
  constructor(
    private readonly sep10: Sep10Service,
    private readonly sep45: Sep45Service,
    private readonly links: WalletLinkService,
  ) {}

  @Get()
  async get(@PlayerId() playerId: string) {
    return { address: await this.links.getAddress(playerId) };
  }

  @Post('challenge')
  @HttpCode(200)
  challenge(@Body() dto: WalletChallengeDto) {
    // Contract accounts (C..., e.g. passkey wallets) use SEP-45; classic
    // accounts (G...) use SEP-10 (#61).
    if (StrKey.isValidContract(dto.address)) {
      return this.sep45.buildChallenge(dto.address);
    }
    return this.sep10.buildChallenge(dto.address);
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@PlayerId() playerId: string, @Body() dto: WalletVerifyDto) {
    let address: string;
    if (StrKey.isValidContract(dto.address)) {
      if (!dto.authorizationEntries) {
        throw new BadRequestException('Send the signed SEP-45 authorizationEntries for a contract account');
      }
      address = await this.sep45.verify(dto.address, dto.authorizationEntries);
    } else {
      if (!dto.signedTransactionXdr) {
        throw new BadRequestException('Send the signed SEP-10 signedTransactionXdr');
      }
      address = await this.sep10.verify(dto.address, dto.signedTransactionXdr);
    }
    const link = await this.links.link(playerId, address);
    return { address: link.address, verifiedAt: link.verifiedAt };
  }
}
