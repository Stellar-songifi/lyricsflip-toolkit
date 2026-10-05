import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { GameService } from './game.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';
import { GameSessionResponseDto } from './dto/game-session.dto';
import { GameMode } from './entities/game-session.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUserId } from '../auth/decorators/current-user.decorator';

@ApiTags('game')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('game')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  /**
   * Solo and room sessions. Head-to-head matches start from a challenge. The
   * session's length is `ROUNDS_PER_SESSION` unless a game mode overrides it.
   */
  @Post('sessions')
  @ApiOkResponse({ type: GameSessionResponseDto })
  createSession(@CurrentUserId() userId: string, @Body() dto: CreateSessionDto) {
    if (dto.mode === GameMode.HEAD_TO_HEAD) {
      throw new BadRequestException('Start a head-to-head match with POST /challenges');
    }
    return this.gameService.createSession(userId, dto.mode);
  }

  @Post('sessions/:id/join')
  @ApiOkResponse({ type: GameSessionResponseDto })
  joinSession(@Param('id', ParseUUIDPipe) id: string, @CurrentUserId() userId: string) {
    return this.gameService.joinSession(id, userId);
  }

  @Get('sessions/:id')
  @ApiOkResponse({ type: GameSessionResponseDto })
  getSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.gameService.getSession(id);
  }

  @Get('sessions/:id/lyric')
  getCurrentLyric(@Param('id', ParseUUIDPipe) id: string) {
    return this.gameService.getCurrentLyric(id);
  }

  @Post('guess')
  submitGuess(@CurrentUserId() userId: string, @Body() dto: SubmitGuessDto) {
    return this.gameService.submitGuess(dto.sessionId, userId, dto.guess);
  }
}
