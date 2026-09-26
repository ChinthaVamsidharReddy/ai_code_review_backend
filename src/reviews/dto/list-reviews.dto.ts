import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListReviewsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  search?: string; // matches summary or issue titles

  @IsOptional()
  @IsIn(['security', 'performance', 'quality'])
  mode?: string;

  @IsOptional()
  @IsIn(['critical', 'high', 'medium', 'low'])
  severity?: string;
}
