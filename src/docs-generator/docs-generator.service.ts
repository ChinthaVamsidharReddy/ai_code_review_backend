import { BadRequestException, Injectable } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { buildReviewContext, prioritizeFiles } from '../reviews/context-builder';
import { GenerateDocsDto } from './dto/generate-docs.dto';

const DOC_INSTRUCTIONS: Record<GenerateDocsDto['docType'], string> = {
  readme: `Generate a professional README.md for this project. Infer the project's purpose, tech stack,
and structure from the provided files. Include: a short description, tech stack, project structure
overview, and a "Getting Started" section. Do not invent features you cannot see evidence of in the code.`,
  setup_guide: `Generate a SETUP.md with step-by-step local setup instructions for this project, inferred from
the files provided (dependency manifests, config files, env usage, scripts). Include prerequisites,
installation steps, environment variable setup, and how to run it.`,
  api_documentation: `Generate API documentation in Markdown for this project's HTTP endpoints. Inspect route/controller
files to identify endpoints, methods, and payloads. For each endpoint list: method, path, purpose,
request body (if any), and response shape (if inferable). If no API endpoints are found, say so clearly
instead of inventing any.`,
};

@Injectable()
export class DocsGeneratorService {
  constructor(
    private readonly filesService: FilesService,
    private readonly aiProvidersService: AiProvidersService,
  ) {}

  async generate(projectId: string, userId: string, dto: GenerateDocsDto): Promise<{ docType: string; markdown: string }> {
    const allFiles = prioritizeFiles(await this.filesService.getAllProjectFiles(projectId));
    if (allFiles.length === 0) {
      throw new BadRequestException('This project has no files to generate documentation from');
    }

    const contentPairs = await Promise.all(
      allFiles.map(async (f) => ({ path: f.relativePath, content: (await this.filesService.readFileText(projectId, f)) ?? '' })),
    );
    const { files } = buildReviewContext(contentPairs);
    const contextBlock = files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');

    const { client } = await this.aiProvidersService.resolveClient(userId, dto.providerId);

    try {
      const result = await client.chat(
        [
          {
            role: 'system',
            content: `You are a technical writer generating accurate, project-specific documentation from real source code. Output clean Markdown only — no commentary before or after.`,
          },
          { role: 'user', content: `${DOC_INSTRUCTIONS[dto.docType]}\n\nProject files:\n\n${contextBlock}` },
        ],
        { temperature: 0.3, maxTokens: 3000 },
      );
      return { docType: dto.docType, markdown: result.content };
    } catch (err) {
      const message = err instanceof AiProviderError ? err.message : (err as Error).message;
      throw new BadRequestException(`Documentation generation failed: ${message}`);
    }
  }
}
