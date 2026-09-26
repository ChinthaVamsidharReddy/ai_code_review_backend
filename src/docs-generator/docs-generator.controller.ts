import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { DocsGeneratorService } from './docs-generator.service';
import { GenerateDocsDto } from './dto/generate-docs.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/docs')
export class DocsGeneratorController {
  constructor(
    private readonly service: DocsGeneratorService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('generate')
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: GenerateDocsDto,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.service.generate(projectId, user.userId, dto);
  }
}
