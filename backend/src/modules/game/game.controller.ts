import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GameService } from './game.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitGuessDto } from './dto/submit-guess.dto';

@ApiTags('game')
@Controller('game')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Post('sessions')
  createSession(@Body() dto: CreateSessionDto) {
    return this.gameService.createSession(dto.hostUserId, dto.mode);
  }

  @Post('sessions/:id/join')
  joinSession(@Param('id') id: string, @Body('userId') userId: string) {
    return this.gameService.joinSession(id, userId);
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return this.gameService.getSession(id);
  }

  @Get('sessions/:id/lyric')
  getCurrentLyric(@Param('id') id: string) {
    return this.gameService.getCurrentLyric(id);
  }

  @Post('guess')
  submitGuess(@Body() dto: SubmitGuessDto) {
    return this.gameService.submitGuess(dto.sessionId, dto.userId, dto.guess);
  }
}
