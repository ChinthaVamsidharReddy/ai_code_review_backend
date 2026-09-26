import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertProviderDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsIn(['openai', 'lm-studio', 'ollama', 'openrouter', 'custom'])
  providerType: string;

  @IsUrl({ require_tld: false }) // allow http://localhost:1234/v1
  baseUrl: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsString()
  @MaxLength(200)
  model: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
