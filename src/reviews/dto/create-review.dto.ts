import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateReviewDto {
  @IsIn(['security', 'performance', 'quality'])
  mode: 'security' | 'performance' | 'quality';

  @IsIn(['single_file', 'multi_file', 'project'])
  scope: 'single_file' | 'multi_file' | 'project';

  /** Required for single_file (1 id) and multi_file (2+ ids). Ignored for
   *  project scope, which reviews all indexed text files. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  fileIds?: string[];

  @IsOptional()
  @IsUUID()
  providerId?: string;
}
