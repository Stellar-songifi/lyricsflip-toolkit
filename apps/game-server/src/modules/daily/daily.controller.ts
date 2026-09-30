import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';
import { DailyService } from './daily.service';

class DailyGuessDto {
  @IsUUID()
  lyricId: string;

  @IsString()
  @MaxLength(200)
  guess: string;
}

@ApiTags('daily')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('daily')
export class DailyController {
  constructor(private readonly daily: DailyService) {}

  @Get()
  today(@CurrentUserId() userId: string) {
    return this.daily.view(userId);
  }

  @Post('guess')
  guess(@CurrentUserId() userId: string, @Body() dto: DailyGuessDto) {
    return this.daily.guess(userId, dto.lyricId, dto.guess);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.daily.leaderboard();
  }
}
