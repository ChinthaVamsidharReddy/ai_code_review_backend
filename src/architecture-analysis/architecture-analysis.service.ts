import { BadRequestException, Injectable } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { callWithResilience } from '../ai-providers/with-resilience';
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

/** Architecture analysis benefits from breadth (seeing the shape of many
 *  files) more than depth in any one of them, so its tiers shrink by
 *  sampling FEWER files at a smaller per-file slice, rather than shrinking
 *  a single-file budget the way review/chat/docs do. */
interface SampleTier {
  label: string;
  fileCount: number;
  perFileChars: number;
}
const SAMPLE_TIERS: SampleTier[] = [
  { label: 'standard', fileCount: 12, perFileChars: 500 },
  { label: 'reduced', fileCount: 6, perFileChars: 350 },
  { label: 'minimal', fileCount: 3, perFileChars: 250 },
];

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

    // The file tree itself is cheap (just paths) and is the same at every
    // tier — full breadth of the project's shape regardless of how much
    // file content ends up fitting.
    const treeText = allFiles
      .map((f) => f.relativePath)
      .sort()
      .slice(0, 300)
      .join('\n');

    const prioritized = prioritizeFiles(allFiles);

    // Cheap upfront check: read a small sample before committing to the
    // full tiered attempt ladder. If storage is missing for this project
    // (see FilesService.getFileContent's `missing` flag / the Explorer's
    // equivalent message), every read will come back empty — better to
    // fail clearly here than produce a confident-looking but baseless
    // architecture summary from empty file bodies.
    const probe = prioritized.slice(0, Math.min(3, prioritized.length));
    const probeContents = await Promise.all(probe.map((f) => this.filesService.readFileText(projectId, f)));
    if (probe.length > 0 && probeContents.every((c) => !c || c.trim().length === 0)) {
      throw new BadRequestException(
        "This project's files are indexed but their stored content is missing on the server (the storage directory may not have been carried over during a redeploy/update). Re-upload the project's ZIP from the Code Explorer tab to restore it, then try again.",
      );
    }

    const { client } = await this.aiProvidersService.resolveClient(userId, providerId);

    const attempts = SAMPLE_TIERS.map((tier) => ({
      label: tier.label,
      run: async () => {
        const sample = prioritized.slice(0, tier.fileCount);
        const contentBlocks = await Promise.all(
          sample.map(async (f) => {
            const content = (await this.filesService.readFileText(projectId, f)) ?? '';
            return `### ${f.relativePath}\n\`\`\`\n${content.slice(0, tier.perFileChars)}\n\`\`\``;
          }),
        );
        return client.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `File tree:\n${treeText}\n\nSample file contents:\n\n${contentBlocks.join('\n\n')}`,
            },
          ],
          { temperature: 0.25, maxTokens: 1200 },
        );
      },
    }));

    try {
      const { result } = await callWithResilience(attempts);
      return { markdown: result.content };
    } catch (err) {
      const message =
        err instanceof AiProviderError
          ? err.kind === 'context_too_large'
            ? 'Even a minimal file sample was too large for this provider/model. Try a provider/model with a larger context window under AI Providers settings.'
            : err.message
          : (err as Error).message;
      throw new BadRequestException(`Architecture analysis failed: ${message}`);
    }
  }
}
