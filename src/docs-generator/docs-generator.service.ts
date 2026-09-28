import { BadRequestException, Injectable } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { callWithResilience } from '../ai-providers/with-resilience';
import { buildReviewContext, DOCS_BUDGET_TIERS, prioritizeFiles, allContentMissing } from '../reviews/context-builder';
import { GenerateDocsDto } from './dto/generate-docs.dto';

const DOC_INSTRUCTIONS: Record<GenerateDocsDto['docType'], string> = {
  readme: `Generate a professional README.md for this project. Infer the project's purpose, tech stack,
and structure from the provided files. Include: a short description, tech stack, project structure
overview, and a "Getting Started" section. Do not invent features you cannot see evidence of in the code.
If only a partial sample of the project's files is shown below, note that structure/imports were used to
infer things and avoid over-claiming detail you can't actually see.`,
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
    if (allContentMissing(contentPairs)) {
      throw new BadRequestException(
        "This project's files are indexed but their stored content is missing on the server (the storage directory may not have been carried over during a redeploy/update). Re-upload the project's ZIP from the Code Explorer tab to restore it, then try again.",
      );
    }

    const { client } = await this.aiProvidersService.resolveClient(userId, dto.providerId);

    // Same shrink-on-rejection ladder as reviews/chat: try the fullest
    // context tier a provider might accept, and only fall back to a
    // smaller one when the provider actually says the request is too big —
    // this is what stops "Documentation generation failed: request too
    // large" on small-context free-tier providers.
    const attempts = DOCS_BUDGET_TIERS.map((tier) => ({
      label: tier.label,
      run: async () => {
        const { files, skippedFileCount } = buildReviewContext(contentPairs, tier);
        const contextBlock = files.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
        const note = skippedFileCount > 0 ? `\n\n(Note: ${skippedFileCount} additional file(s) were omitted to stay within context limits — base the docs on what's shown.)` : '';
        return client.chat(
          [
            {
              role: 'system',
              content: `You are a technical writer generating accurate, project-specific documentation from real source code. Output clean Markdown only — no commentary before or after.`,
            },
            { role: 'user', content: `${DOC_INSTRUCTIONS[dto.docType]}\n\nProject files:\n\n${contextBlock}${note}` },
          ],
          { temperature: 0.3, maxTokens: 1500 },
        );
      },
    }));

    try {
      const { result } = await callWithResilience(attempts);
      return { docType: dto.docType, markdown: result.content };
    } catch (err) {
      const message =
        err instanceof AiProviderError
          ? err.kind === 'context_too_large'
            ? 'Even the smallest context this app sends was too large for this provider/model. Try a provider/model with a larger context window under AI Providers settings.'
            : err.message
          : (err as Error).message;
      throw new BadRequestException(`Documentation generation failed: ${message}`);
    }
  }
}
