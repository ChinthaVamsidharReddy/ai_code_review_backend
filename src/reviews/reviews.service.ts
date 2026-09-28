import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review } from './review.entity';
import { ReviewIssue, Severity } from './review-issue.entity';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsDto } from './dto/list-reviews.dto';
import { FilesService } from '../files/files.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiProviderError } from '../ai-providers/ai-client.interface';
import { buildReviewContext, prioritizeFiles, allContentMissing, REVIEW_BUDGET_TIERS } from './context-builder';
import { buildSystemPrompt, buildUserPrompt } from './review-templates';
import { callWithResilience } from '../ai-providers/with-resilience';

interface ParsedIssue {
  title: string;
  description: string;
  severity: Severity;
  filePath?: string | null;
  lineHint?: string | null;
  recommendation?: string | null;
}

interface ParsedReviewOutput {
  summary: string;
  issues: ParsedIssue[];
  generalRecommendations?: string[];
}

const VALID_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(Review) private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewIssue) private readonly issueRepo: Repository<ReviewIssue>,
    private readonly filesService: FilesService,
    private readonly aiProvidersService: AiProvidersService,
  ) {}

  async create(projectId: string, userId: string, dto: CreateReviewDto): Promise<Review> {
    const candidateFiles = await this.resolveFiles(projectId, dto);
    if (candidateFiles.length === 0) {
      throw new BadRequestException('No reviewable (non-binary) files were found for the requested scope');
    }

    const contentPairs = await Promise.all(
      candidateFiles.map(async (f) => ({
        path: f.relativePath,
        content: (await this.filesService.readFileText(projectId, f)) ?? '',
      })),
    );
    if (allContentMissing(contentPairs)) {
      throw new BadRequestException(
        "This project's files are indexed but their stored content is missing on the server (the storage directory may not have been carried over during a redeploy/update). Re-upload the project's ZIP from the Code Explorer tab to restore it, then try again.",
      );
    }

    const scopeLabel = { single_file: 'single file', multi_file: 'selected files', project: 'entire project' }[dto.scope];
    const systemPrompt = buildSystemPrompt(dto.mode);
    const { client, config } = await this.aiProvidersService.resolveClient(userId, dto.providerId);

    // Try the fullest context tier first, then progressively smaller ones —
    // this is what makes reviews work reliably on small-context free-tier
    // providers (e.g. Groq's free tier) without sacrificing breadth on
    // providers that can actually handle a bigger request.
    let lastContextFiles: ReturnType<typeof buildReviewContext>['files'] = [];
    const attempts = REVIEW_BUDGET_TIERS.map((tier) => ({
      label: tier.label,
      run: async () => {
        const { files: contextFiles, skippedFileCount } = buildReviewContext(contentPairs, tier);
        lastContextFiles = contextFiles;
        const userPrompt =
          buildUserPrompt(contextFiles, scopeLabel) +
          (skippedFileCount > 0
            ? `\n\n(Note: ${skippedFileCount} additional file(s) were omitted to stay within context limits.)`
            : '');
        return client.chat(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          { jsonMode: true, temperature: 0.15, maxTokens: 1800 },
        );
      },
    }));

    try {
      const { result, tierLabel } = await callWithResilience(attempts);
      if (tierLabel !== REVIEW_BUDGET_TIERS[0].label) {
        this.logger.warn(
          `Review for project ${projectId} used the "${tierLabel}" context tier — the provider rejected larger context as too big.`,
        );
      }

      const parsed = this.parseAiOutput(result.content);
      const review = this.reviewRepo.create({
        projectId,
        requestedByUserId: userId,
        mode: dto.mode,
        scope: dto.scope,
        filePaths: lastContextFiles.map((f) => f.path),
        summary: parsed.summary,
        generalRecommendations: parsed.generalRecommendations ?? [],
        status: 'completed',
        aiModel: result.model,
        issues: parsed.issues.map((i) =>
          this.issueRepo.create({
            title: i.title,
            description: i.description,
            severity: i.severity,
            filePath: i.filePath ?? undefined,
            lineHint: i.lineHint ?? undefined,
            recommendation: i.recommendation ?? undefined,
          }),
        ),
      });
      return this.reviewRepo.save(review);
    } catch (err) {
      // AI/provider failures produce a *persisted, visible* failed review
      // rather than a bare 500 — the user can see what was attempted and
      // why it failed, and review history stays complete.
      const message =
        err instanceof AiProviderError
          ? this.friendlyProviderMessage(err)
          : `Review failed: ${(err as Error).message}`;
      this.logger.warn(`Review failed for project ${projectId}: ${message}`);

      const failed = this.reviewRepo.create({
        projectId,
        requestedByUserId: userId,
        mode: dto.mode,
        scope: dto.scope,
        filePaths: lastContextFiles.map((f) => f.path),
        summary: '',
        generalRecommendations: [],
        status: 'failed',
        errorMessage: message,
        aiModel: config.model,
        issues: [],
      });
      return this.reviewRepo.save(failed);
    }
  }

  async list(projectId: string, query: ListReviewsDto) {
    const { page, pageSize, search, mode, severity } = query;
    const qb = this.reviewRepo
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.issues', 'issue')
      .where('review.projectId = :projectId', { projectId })
      .orderBy('review.createdAt', 'DESC');

    if (mode) qb.andWhere('review.mode = :mode', { mode });
    if (search) {
      qb.andWhere('(review.summary ILIKE :search OR issue.title ILIKE :search)', { search: `%${search}%` });
    }
    if (severity) qb.andWhere('issue.severity = :severity', { severity });

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return { items, total, page, pageSize };
  }

  async get(projectId: string, reviewId: string): Promise<Review> {
    const review = await this.reviewRepo.findOne({ where: { id: reviewId, projectId }, relations: ['issues'] });
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  private async resolveFiles(projectId: string, dto: CreateReviewDto) {
    if (dto.scope === 'project') {
      const all = await this.filesService.getAllProjectFiles(projectId);
      return prioritizeFiles(all);
    }

    if (!dto.fileIds || dto.fileIds.length === 0) {
      throw new BadRequestException(`fileIds is required for scope "${dto.scope}"`);
    }
    if (dto.scope === 'single_file' && dto.fileIds.length !== 1) {
      throw new BadRequestException('scope "single_file" requires exactly one fileId');
    }

    const files = await this.filesService.getFilesByIds(projectId, dto.fileIds);
    return prioritizeFiles(files);
  }

  /** Defensively parses the model's JSON output: strips accidental markdown
   *  fences, validates required fields, coerces unknown severities to
   *  "medium" rather than crashing the whole review on one bad field. */
  private parseAiOutput(raw: string): ParsedReviewOutput {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

    let json: any;
    try {
      json = JSON.parse(cleaned);
    } catch {
      throw new AiProviderError('AI provider returned output that was not valid JSON', 'malformed_response');
    }

    if (typeof json !== 'object' || json === null || typeof json.summary !== 'string' || !Array.isArray(json.issues)) {
      throw new AiProviderError('AI provider response did not match the expected review format', 'malformed_response');
    }

    const issues: ParsedIssue[] = json.issues
      .filter((i: any) => i && typeof i.title === 'string' && typeof i.description === 'string')
      .map((i: any) => ({
        title: String(i.title).slice(0, 300),
        description: String(i.description).slice(0, 4000),
        severity: VALID_SEVERITIES.includes(i.severity) ? i.severity : 'medium',
        filePath: typeof i.filePath === 'string' ? i.filePath : null,
        lineHint: typeof i.lineHint === 'string' ? i.lineHint : null,
        recommendation: typeof i.recommendation === 'string' ? i.recommendation.slice(0, 2000) : null,
      }));

    const generalRecommendations = Array.isArray(json.generalRecommendations)
      ? json.generalRecommendations.filter((r: unknown) => typeof r === 'string').slice(0, 20)
      : [];

    return { summary: json.summary.slice(0, 2000), issues, generalRecommendations };
  }

  private friendlyProviderMessage(err: AiProviderError): string {
    const messages: Record<AiProviderError['kind'], string> = {
      timeout: 'The AI provider took too long to respond. Try again, or switch to a faster model.',
      rate_limited: 'The AI provider is rate-limiting requests right now. Wait a moment and try again.',
      invalid_api_key: 'The configured API key was rejected by the provider. Check it under AI Providers settings.',
      unavailable: 'The AI provider is currently unavailable.',
      invalid_model: 'The configured model name was not recognized by the provider.',
      empty_response: 'The AI provider returned an empty response.',
      malformed_response: 'The AI provider returned a response that could not be parsed. Try again.',
      network: 'Could not reach the AI provider. Check the configured base URL.',
      context_too_large:
        'Even the smallest context this app sends was too large for this provider/model. Try reviewing a single smaller file, or switch to a provider/model with a larger context window under AI Providers settings.',
      unknown: 'The AI provider returned an unexpected error.',
    };
    return messages[err.kind] ?? err.message;
  }
}
