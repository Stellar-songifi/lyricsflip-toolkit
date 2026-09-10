import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('auth')
@Controller('auth/stellar')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenge')
  getChallenge(@Body() dto: ChallengeDto) {
    return this.authService.getChallenge(dto.walletAddress);
  }

  @Post('verify')
  verify(@Body() dto: VerifyDto) {
    return this.authService.verify(dto.walletAddress, dto.signedTransactionXdr);
  }
}
