import { IsString, IsUUID } from 'class-validator';

export class SubmitGuessDto {
  @IsUUID()
  sessionId: string;

  @IsUUID()
  userId: string;

  @IsString()
  guess: string;
}
