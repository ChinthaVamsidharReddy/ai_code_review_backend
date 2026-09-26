import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './review.entity';
import { ReviewIssue } from './review-issue.entity';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { FilesModule } from '../files/files.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [TypeOrmModule.forFeature([Review, ReviewIssue]), FilesModule, AiProvidersModule, ProjectsModule],
  providers: [ReviewsService],
  controllers: [ReviewsController],
  exports: [ReviewsService, TypeOrmModule],
})
export class ReviewsModule {}
