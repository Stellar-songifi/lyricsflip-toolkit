import { IsUUID } from 'class-validator';

export class AcceptChallengeDto {
  @IsUUID()
  userId: string;
}
