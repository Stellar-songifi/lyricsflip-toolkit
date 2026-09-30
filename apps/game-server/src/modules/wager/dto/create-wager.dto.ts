import { IsNumberString, IsUUID } from 'class-validator';

export class CreateWagerDto {
  @IsUUID()
  gameSessionId: string;

  @IsUUID()
  playerAId: string;

  @IsUUID()
  playerBId: string;

  /** Stroops, as a string — never a float. */
  @IsNumberString()
  stakeAmount: string;
}
