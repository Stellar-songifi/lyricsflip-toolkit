import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { AcceptChallengeDto } from './dto/accept-challenge.dto';

@ApiTags('challenges')
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Post()
  create(@Body() dto: CreateChallengeDto) {
    return this.challengesService.create(dto.hostUserId, dto.stakeAmount);
  }

  @Get(':code')
  getByCode(@Param('code') code: string) {
    return this.challengesService.getByCode(code);
  }

  @Post(':code/accept')
  accept(@Param('code') code: string, @Body() dto: AcceptChallengeDto) {
    return this.challengesService.accept(code, dto.userId);
  }
}
