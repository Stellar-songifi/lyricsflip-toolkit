import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

/**
 * Public projection of a user. Only fields that are safe to expose on
 * unauthenticated routes (leaderboard, GET /users/:id) belong here.
 * Sensitive columns such as walletAddress, walletVerifiedAt and timestamps
 * are intentionally omitted so new columns stay private by default.
 */
@Exclude()
export class PublicUserDto {
  @Expose()
  @ApiProperty({ description: 'User id' })
  id!: string;

  @Expose()
  @ApiProperty({ description: 'Public username' })
  username!: string;

  @Expose()
  @ApiProperty({ description: 'Player level' })
  level!: number;

  @Expose()
  @ApiProperty({ description: 'Experience points' })
  xp!: number;

  @Expose()
  @ApiProperty({ description: 'Number of correct guesses' })
  correctGuesses!: number;

  @Expose()
  @ApiProperty({ description: 'Number of games played' })
  gamesPlayed!: number;
}
