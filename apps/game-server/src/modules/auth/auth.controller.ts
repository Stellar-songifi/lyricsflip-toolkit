import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

class ChallengeDto {
  @IsString()
  walletAddress: string;
}

class VerifyDto {
  @IsString()
  walletAddress: string;

  @IsString()
  signedTransactionXdr: string;
}

class RefreshDto {
  @IsString()
  refreshToken: string;
}

class LogoutDto {
  @IsString()
  refreshToken: string;
}

@ApiTags('auth')
@UseGuards(ThrottlerGuard)
@Controller('auth/stellar')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenge')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  getChallenge(@Body() dto: ChallengeDto) {
    return this.authService.getChallenge(dto.walletAddress);
  }

  @Post('verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verify(dto.walletAddress, dto.signedTransactionXdr);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
