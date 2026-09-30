import { IsNumberString, IsOptional, IsUUID } from 'class-validator';

export class CreateChallengeDto {
  @IsUUID()
  hostUserId: string;

  /** Stroops, as a string. Omit for an unstaked match. */
  @IsOptional()
  @IsNumberString()
  stakeAmount?: string;
}
