import { IsString, IsUUID, MaxLength } from 'class-validator';

export class SubmitGuessDto {
  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(200)
  guess: string;
}

export class SessionPayloadDto {
  @IsUUID()
  sessionId: string;
}

export class SubmitGuessPayloadDto {
  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(200)
  guess: string;
}
