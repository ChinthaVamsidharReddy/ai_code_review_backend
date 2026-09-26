import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from './chat-session.entity';
import { ChatMessage } from './chat-message.entity';
import { AskQuestionDto } from './dto/ask-question.dto';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { retrieveRelevantFiles } from './context-retrieval';
import { buildReviewContext } from '../reviews/context-builder';

const SYSTEM_PROMPT = `You are a helpful assistant answering questions about a specific codebase.
Only use the file excerpts provided below as context. If the answer isn't clearly supported by
them, say what you can infer and note that you don't have enough context rather than guessing.
Reference specific file paths in your answer when relevant. Keep answers concise and technical.`;

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession) private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage) private readonly messageRepo: Repository<ChatMessage>,
    private readonly filesService: FilesService,
    private readonly aiProvidersService: AiProvidersService,
  ) {}

  async listSessions(projectId: string) {
    return this.sessionRepo.find({ where: { projectId }, order: { updatedAt: 'DESC' } });
  }

  async getSessionMessages(projectId: string, sessionId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, projectId } });
    if (!session) throw new NotFoundException('Chat session not found');
    return this.messageRepo.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
  }

  async ask(projectId: string, userId: string, dto: AskQuestionDto) {
    let session: ChatSession | null = null;
    if (dto.sessionId) {
      session = await this.sessionRepo.findOne({ where: { id: dto.sessionId, projectId } });
      if (!session) throw new NotFoundException('Chat session not found');
    } else {
      session = await this.sessionRepo.save(
        this.sessionRepo.create({ projectId, userId, title: dto.question.slice(0, 80) }),
      );
    }

    const allFiles = await this.filesService.getAllProjectFiles(projectId);
    const textFiles = allFiles.filter((f) => !f.isBinary);
    if (textFiles.length === 0) {
      throw new BadRequestException('This project has no readable source files to chat about yet');
    }

    const withContent = await Promise.all(
      textFiles.map(async (file) => ({ file, content: (await this.filesService.readFileText(projectId, file)) ?? '' })),
    );
    const contentById = new Map(withContent.map((w) => [w.file.id, w.content]));
    const relevant = retrieveRelevantFiles(dto.question, withContent, 6);
    const { files: contextFiles } = buildReviewContext(
      relevant.map((r) => ({ path: r.file.relativePath, content: contentById.get(r.file.id) ?? '' })),
    );

    const contextBlock = contextFiles
      .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');

    const userMessage = await this.messageRepo.save(
      this.messageRepo.create({
        sessionId: session.id,
        role: 'user',
        content: dto.question,
        contextFilePaths: contextFiles.map((f) => f.path),
      }),
    );

    const { client } = await this.aiProvidersService.resolveClient(userId, dto.providerId);

    try {
      const priorMessages = await this.messageRepo.find({
        where: { sessionId: session.id },
        order: { createdAt: 'ASC' },
        take: 10, // short rolling history; keeps prompts bounded
      });

      const result = await client.chat(
        [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\nRelevant code:\n${contextBlock || '(no matching files found)'}` },
          ...priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        { temperature: 0.2, maxTokens: 1200 },
      );

      const assistantMessage = await this.messageRepo.save(
        this.messageRepo.create({
          sessionId: session.id,
          role: 'assistant',
          content: result.content,
          contextFilePaths: contextFiles.map((f) => f.path),
        }),
      );
      await this.sessionRepo.update(session.id, { updatedAt: new Date() });

      return { session, userMessage, assistantMessage, contextFiles: contextFiles.map((f) => f.path) };
    } catch (err) {
      const message =
        err instanceof AiProviderError
          ? `AI provider error: ${err.message}`
          : `Chat failed: ${(err as Error).message}`;
      const assistantMessage = await this.messageRepo.save(
        this.messageRepo.create({ sessionId: session.id, role: 'assistant', content: `⚠️ ${message}`, contextFilePaths: [] }),
      );
      return { session, userMessage, assistantMessage, contextFiles: [], error: message };
    }
  }
}
