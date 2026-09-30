import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';
import { FaucetService } from './faucet.service';

@ApiTags('faucet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucet: FaucetService) {}

  /** Whether the faucet is on, and which asset the wallet must trust. */
  @Get()
  info() {
    return this.faucet.info();
  }

  @Post()
  claim(@CurrentUserId() userId: string) {
    return this.faucet.claim(userId);
  }
}
