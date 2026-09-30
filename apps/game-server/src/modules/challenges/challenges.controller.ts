import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';

@ApiTags('challenges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateChallengeDto) {
    return this.challengesService.create(userId, dto.stakeAmount, dto.opponentUsername);
  }

  @Get(':code')
  getByCode(@Param('code') code: string) {
    return this.challengesService.getByCode(code);
  }

  @Post(':code/accept')
  accept(@Param('code') code: string, @CurrentUserId() userId: string) {
    return this.challengesService.accept(code, userId);
  }
}
