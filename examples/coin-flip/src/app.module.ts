import { Body, Controller, Module, Post, UnauthorizedException, Req, HttpCode } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsString, Matches } from 'class-validator';
import {
  PVP_ENTITIES,
  PVP_MIGRATIONS,
  PvpSettlementModule,
  Sep10Service,
  WalletLinkService,
} from '@lyricsflip-toolkit/server';
import { CoinFlipService } from './coin-flip.service';
import { Tokens } from './tokens';
import { config } from './config';
import { pvpEvents } from './events';

class ChallengeDto {
  @IsString()
  address: string;
}

class VerifyDto {
  @IsString()
  address: string;

  @IsString()
  signedTransactionXdr: string;
}

class ProposeDto {
  /** The opponent's wallet address; in this example a player is their wallet. */
  @IsString()
  opponent: string;

  @Matches(/^\d+$/)
  stakeAmount: string;
}

export const tokens = new Tokens(config.tokenSecret);

@Controller()
class CoinFlipController {
  constructor(
    private readonly flips: CoinFlipService,
    private readonly sep10: Sep10Service,
    private readonly links: WalletLinkService,
  ) {}

  /** Sign in with a Stellar wallet (SEP-10). The wallet address is the player id. */
  @Post('login/challenge')
  @HttpCode(200)
  challenge(@Body() dto: ChallengeDto) {
    return this.sep10.buildChallenge(dto.address);
  }

  @Post('login/verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyDto) {
    const address = await this.sep10.verify(dto.address, dto.signedTransactionXdr);
    await this.links.link(address, address);
    return { token: tokens.issue(address) };
  }

  /** Propose a flip. The opponent then uses POST /wagers/:id/accept and both stake. */
  @Post('flips')
  propose(@Req() req: { headers: Record<string, unknown> }, @Body() dto: ProposeDto) {
    const playerId = tokens.fromRequest(req);
    if (!playerId) throw new UnauthorizedException();
    return this.flips.propose(playerId, dto.opponent, dto.stakeAmount);
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: config.databaseUrl,
      entities: PVP_ENTITIES,
      migrations: PVP_MIGRATIONS,
      migrationsRun: true,
      extra: config.databaseSchema ? { options: `-c search_path=${config.databaseSchema}` } : undefined,
    }),
    PvpSettlementModule.forRoot({
      mode: config.settlementMode,
      stellar: config.stellar,
      sep10: config.sep10,
      authenticate: (req) => tokens.fromRequest(req as { headers: Record<string, unknown> }),
      onEvent: (event) => pvpEvents.next(event),
    }),
  ],
  controllers: [CoinFlipController],
  providers: [CoinFlipService],
})
export class AppModule {}
