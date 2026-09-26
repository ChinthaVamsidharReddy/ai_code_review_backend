import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { ChatService } from './chat.service';
import { AskQuestionDto } from './dto/ask-question.dto';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.chatService.listSessions(projectId);
  }

  @Get('sessions/:sessionId/messages')
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.chatService.getSessionMessages(projectId, sessionId);
  }

  @Post('ask')
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AskQuestionDto,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.chatService.ask(projectId, user.userId, dto);
  }
}
