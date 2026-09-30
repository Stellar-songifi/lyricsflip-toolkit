import { IsEnum } from 'class-validator';
import { GameMode } from '../entities/game-session.entity';

export class CreateSessionDto {
  @IsEnum(GameMode)
  mode: GameMode;
}
