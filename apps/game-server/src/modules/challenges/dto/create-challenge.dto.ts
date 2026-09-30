import { IsNumberString, IsOptional } from 'class-validator';

export class CreateChallengeDto {
  /** Stroops, as a string. Omit for an unstaked match. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  stakeAmount?: string;
}
