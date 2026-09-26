import { BadRequestException, Injectable } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { prioritizeFiles } from '../reviews/context-builder';

const SYSTEM_PROMPT = `You are a senior software architect. You are given a project's file tree and a sample of
its source files. Produce a concise architecture summary in Markdown covering:
1. Overall architecture style (e.g. layered, MVC, modular monolith) as best you can infer
2. Key modules/directories and their responsibilities
3. Notable design patterns in use
4. Apparent data flow (e.g. request -> controller -> service -> data layer)
5. Any structural concerns worth flagging (tight coupling, unclear boundaries, mixed responsibilities)
Be honest about uncertainty — say "appears to" rather than asserting things you can't see evidence for.
Output Markdown only, no commentary before or after.`;

@Injectable()
export class ArchitectureAnalysisService {
  constructor(
    private readonly filesService: FilesService,
    private readonly aiProvidersService: AiProvidersService,
  ) {}

  async analyze(projectId: string, userId: string, providerId?: string) {
    const allFiles = await this.filesService.getAllProjectFiles(projectId);
    if (allFiles.length === 0) {
      throw new BadRequestException('This project has no files to analyze');
    }

    const treeText = allFiles
      .map((f) => f.relativePath)
      .sort()
      .join('\n');

    // Architecture analysis benefits more from breadth (seeing the shape of
    // many files) than depth, so unlike reviews/docs we sample a smaller
    // slice of each file's content across more files.
    const sample = prioritizeFiles(allFiles).slice(0, 25);
    const contentPairs = await Promise.all(
      sample.map(async (f) => {
        const content = (await this.filesService.readFileText(projectId, f)) ?? '';
        return `### ${f.relativePath}\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``;
      }),
    );

    const { client } = await this.aiProvidersService.resolveClient(userId, providerId);

    try {
      const result = await client.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `File tree:\n${treeText}\n\nSample file contents:\n\n${contentPairs.join('\n\n')}`,
          },
        ],
        { temperature: 0.25, maxTokens: 2500 },
      );
      return { markdown: result.content };
    } catch (err) {
      const message = err instanceof AiProviderError ? err.message : (err as Error).message;
      throw new BadRequestException(`Architecture analysis failed: ${message}`);
    }
  }
}
