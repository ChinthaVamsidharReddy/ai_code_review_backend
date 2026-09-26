import { IsOptional, IsUUID } from 'class-validator';

export class AnalyzeDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;
}
