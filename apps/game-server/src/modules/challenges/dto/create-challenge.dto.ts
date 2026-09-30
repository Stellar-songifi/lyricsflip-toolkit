import { IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChallengeDto {
  /** Stroops, as a string. Omit for an unstaked match. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  stakeAmount?: string;

  /** Invite a specific player; they get a push notification with the code. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  opponentUsername?: string;
}
