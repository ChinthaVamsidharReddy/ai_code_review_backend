import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSession } from './chat-session.entity';
import { ChatMessage } from './chat-message.entity';
import { AskQuestionDto } from './dto/ask-question.dto';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { callWithResilience } from '../ai-providers/with-resilience';
import { retrieveRelevantFiles } from './context-retrieval';
import { buildReviewContext, CHAT_BUDGET_TIERS } from '../reviews/context-builder';

const BASE_SYSTEM_PROMPT = `You are a helpful assistant answering questions about a specific codebase.
When file excerpts are provided below, use only them as context — if the answer isn't clearly
supported by them, say what you can infer and note that you don't have enough context rather than
guessing. Reference specific file paths in your answer when relevant. Keep answers concise and
technical. If no file excerpts are provided, answer from the project name/description alone and say
so if the question needs more detail than that gives you — don't invent file contents you weren't shown.`;

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

  /**
   * `projectMeta` (name/description) is passed in by the controller, which
   * already loaded the Project row for the ownership check — this lets a
   * purely factual question ("what's this project called?") be answered
   * for a few dozen bytes of context instead of the app assuming every
   * question needs full file content.
   */
  async ask(projectId: string, userId: string, dto: AskQuestionDto, projectMeta: { name: string; description?: string }) {
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
    const relevant = retrieveRelevantFiles(dto.question, withContent, 4);
    const candidates = relevant.map((r) => ({ path: r.file.relativePath, content: contentById.get(r.file.id) ?? '' }));

    const projectLine = `Project: "${projectMeta.name}"${projectMeta.description ? ` — ${projectMeta.description}` : ''}`;
    const fileListLine = `Files in this project: ${textFiles.map((f) => f.relativePath).slice(0, 60).join(', ')}${
      textFiles.length > 60 ? `, and ${textFiles.length - 60} more` : ''
    }`;

    const userMessage = await this.messageRepo.save(
      this.messageRepo.create({
        sessionId: session.id,
        role: 'user',
        content: dto.question,
        contextFilePaths: candidates.map((c) => c.path),
      }),
    );

    const { client } = await this.aiProvidersService.resolveClient(userId, dto.providerId);

    const priorMessages = await this.messageRepo.find({
      where: { sessionId: session.id },
      order: { createdAt: 'ASC' },
      take: 8, // short rolling history; keeps prompts bounded
    });
    // The message we just saved is included in `priorMessages` (it was just
    // persisted above) — drop the trailing duplicate before replaying it as
    // history alongside the fresh user prompt built per-tier below.
    const history = priorMessages.slice(0, -1).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Ladder of attempts, largest-genuinely-relevant-context first:
    //  1..N: shrinking tiers of the candidate files found by retrieval
    //  final: no file content at all — just project name/description/file
    //         list. This tier is what guarantees a trivial question never
    //         fails outright even on the smallest-context provider, and
    //         it's also exactly what fixes "what's the project name?"
    //         blowing up: that question needs none of the file content it
    //         was previously being sent.
    const tieredAttempts = candidates.length > 0
      ? CHAT_BUDGET_TIERS.map((tier) => ({
          label: tier.label,
          run: async () => {
            const { files: contextFiles } = buildReviewContext(candidates, tier);
            const contextBlock = contextFiles
              .map((f) => `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
              .join('\n\n');
            return client.chat(
              [
                {
                  role: 'system',
                  content: `${BASE_SYSTEM_PROMPT}\n\n${projectLine}\n${fileListLine}\n\nRelevant code:\n${contextBlock}`,
                },
                ...history,
                { role: 'user', content: dto.question },
              ],
              { temperature: 0.2, maxTokens: 700 },
            );
          },
        }))
      : [];

    const overviewOnlyAttempt = {
      label: 'overview_only',
      run: () =>
        client.chat(
          [
            { role: 'system', content: `${BASE_SYSTEM_PROMPT}\n\n${projectLine}\n${fileListLine}` },
            ...history,
            { role: 'user', content: dto.question },
          ],
          { temperature: 0.2, maxTokens: 500 },
        ),
    };

    try {
      const { result, tierLabel } = await callWithResilience([...tieredAttempts, overviewOnlyAttempt]);
      const usedFilePaths = tierLabel === 'overview_only' ? [] : candidates.map((c) => c.path);

      const assistantMessage = await this.messageRepo.save(
        this.messageRepo.create({
          sessionId: session.id,
          role: 'assistant',
          content: result.content,
          contextFilePaths: usedFilePaths,
        }),
      );
      await this.sessionRepo.update(session.id, { updatedAt: new Date() });

      return { session, userMessage, assistantMessage, contextFiles: usedFilePaths };
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
