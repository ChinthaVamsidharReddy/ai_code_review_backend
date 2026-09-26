import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class GenerateDocsDto {
  @IsIn(['readme', 'setup_guide', 'api_documentation'])
  docType: 'readme' | 'setup_guide' | 'api_documentation';

  @IsOptional()
  @IsUUID()
  providerId?: string;
}
