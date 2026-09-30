import { IsString, IsUUID, MaxLength } from 'class-validator';

export class SubmitGuessDto {
  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(200)
  guess: string;
}
