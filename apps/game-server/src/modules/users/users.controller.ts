import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';
import { LEVEL_THRESHOLDS } from './entities/user.entity';

class UpdateMeDto {
  @IsString()
  @Matches(/^[a-z0-9_]{3,20}$/, { message: 'username must be 3-20 lowercase letters, digits or _' })
  username: string;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('leaderboard')
  getLeaderboard(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.usersService.getLeaderboard(parsed);
  }

  /** The signed-in player, with the XP needed for their next level. */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUserId() userId: string) {
    const user = await this.usersService.findById(userId);
    const next = LEVEL_THRESHOLDS.find((t) => t.minXp > user.xp) ?? null;
    return { ...user, nextLevel: next ? { level: next.level, minXp: next.minXp } : null };
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUserId() userId: string, @Body() dto: UpdateMeDto) {
    return this.usersService.rename(userId, dto.username);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }
}
