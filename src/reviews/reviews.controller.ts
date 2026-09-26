import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/reviews')
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateReviewDto,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.reviewsService.create(projectId, user.userId, dto);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListReviewsDto,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.reviewsService.list(projectId, query);
  }

  @Get(':reviewId')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.reviewsService.get(projectId, reviewId);
  }
}
