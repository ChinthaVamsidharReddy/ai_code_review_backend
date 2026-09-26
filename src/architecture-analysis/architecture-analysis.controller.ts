import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ArchitectureAnalysisService } from './architecture-analysis.service';
import { AnalyzeDto } from './dto/analyze.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/architecture-analysis')
export class ArchitectureAnalysisController {
  constructor(
    private readonly service: ArchitectureAnalysisService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post()
  async analyze(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AnalyzeDto,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.service.analyze(projectId, user.userId, dto.providerId);
  }
}
