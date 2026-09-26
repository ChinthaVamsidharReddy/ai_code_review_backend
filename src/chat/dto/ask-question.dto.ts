import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AskQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string; // omit to start a new session

  @IsOptional()
  @IsUUID()
  providerId?: string;
}
