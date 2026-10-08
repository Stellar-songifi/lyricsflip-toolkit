import { IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitGuessDto {
  @ApiProperty({ description: 'The game session UUID.' })
  @IsUUID()
  sessionId: string;

  @ApiProperty({
    description: 'The player\'s guess. Maximum 200 characters.',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  guessText: string;
}
