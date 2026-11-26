import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ChallengesService } from './challenges.service';

@Controller('challenges')
@UseGuards(ThrottlerGuard)
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get(':code')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async findOne(@Param('code') code: string) {
    return this.challengesService.findByCode(code);
  }
}
