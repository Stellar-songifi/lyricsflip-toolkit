import { IsEnum, IsUUID } from 'class-validator';
import { GameMode } from '../entities/game-session.entity';

export class CreateSessionDto {
  @IsUUID()
  hostUserId: string;

  @IsEnum(GameMode)
  mode: GameMode;
}
