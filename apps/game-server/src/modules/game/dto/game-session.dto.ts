import { ApiProperty } from '@nestjs/swagger';
import { GameMode, GameSessionStatus } from '../entities/game-session.entity';

/**
 * A game session as the HTTP routes and the `/game` socket namespace return it.
 * Documented so `totalRounds` — the round the session finishes at — shows up in
 * Swagger; clients need it to render "round N of M".
 */
export class GameSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: GameMode, enumName: 'GameMode' })
  mode: GameMode;

  @ApiProperty({ enum: GameSessionStatus, enumName: 'GameSessionStatus' })
  status: GameSessionStatus;

  @ApiProperty({ type: [String], format: 'uuid' })
  playerIds: string[];

  @ApiProperty({ nullable: true, format: 'uuid' })
  currentLyricId: string | null;

  @ApiProperty({ description: 'The round being played.', example: 1 })
  currentRound: number;

  @ApiProperty({
    description: 'Rounds this session runs for; it finishes once `currentRound` reaches it.',
    example: 10,
  })
  totalRounds: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'number' },
    description: 'Points per player id.',
    example: { '7f3c1b9e-0a5d-4a4e-9a2b-2c1f4f6d8e01': 120 },
  })
  scores: Record<string, number>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}
