import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** All fields optional — a PATCH only changes what's sent. Distinct from
 *  UpsertProviderDto (used for creation, where name/baseUrl/model/type are
 *  required) rather than reusing it with everything re-declared optional,
 *  so validation stays honest about what create vs. update actually need. */
export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['openai', 'lm-studio', 'ollama', 'openrouter', 'custom'])
  providerType?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  /** Only re-encrypts and replaces the stored key if a non-empty value is
   *  sent — omit this field entirely to leave the existing key untouched. */
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
