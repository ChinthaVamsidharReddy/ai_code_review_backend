import { ReviewsService } from '../reviews.service';
import { AiProviderError } from '../../ai-providers/ai-client.interface';

/** Minimal fakes — this test is about ReviewsService's own logic (output
 *  parsing, severity coercion, failure persistence), not TypeORM or the
 *  HTTP client, so both are replaced with the smallest thing that behaves
 *  like them. */
function makeReviewRepo() {
  return {
    create: jest.fn((v) => v),
    save: jest.fn((entity) => Promise.resolve({ id: 'review-1', ...entity })),
  } as any;
}
function makeIssueRepo() {
  return { create: jest.fn((v) => v) } as any;
}
function makeFilesService(files: { relativePath: string; isBinary?: boolean; sizeBytes?: number }[]) {
  return {
    getFilesByIds: jest.fn().mockResolvedValue(files.map((f) => ({ ...f, id: f.relativePath, isBinary: !!f.isBinary, sizeBytes: f.sizeBytes ?? 100 }))),
    getAllProjectFiles: jest.fn().mockResolvedValue(files.map((f) => ({ ...f, id: f.relativePath, isBinary: !!f.isBinary, sizeBytes: f.sizeBytes ?? 100 }))),
    readFileText: jest.fn().mockResolvedValue('const x = 1; // sample content'),
  } as any;
}
function makeAiProvidersService(chatImpl: (...args: any[]) => Promise<any>) {
  return {
    resolveClient: jest.fn().mockResolvedValue({
      client: { chat: jest.fn(chatImpl) },
      config: { model: 'test-model', name: 'Test Provider' },
    }),
  } as any;
}

describe('ReviewsService.create', () => {
  it('parses a well-formed structured AI response into a completed review', async () => {
    const reviewRepo = makeReviewRepo();
    const filesService = makeFilesService([{ relativePath: 'src/app.ts' }]);
    const aiProvidersService = makeAiProvidersService(async () => ({
      content: JSON.stringify({
        summary: 'Found one issue.',
        issues: [
          {
            title: 'Hardcoded secret',
            description: 'A secret is hardcoded.',
            severity: 'critical',
            filePath: 'src/app.ts',
            lineHint: 'near the top',
            recommendation: 'Use an environment variable.',
          },
        ],
        generalRecommendations: ['Add a linter rule for this.'],
      }),
      model: 'test-model',
    }));

    const service = new ReviewsService(reviewRepo, makeIssueRepo(), filesService, aiProvidersService);
    const review = await service.create('project-1', 'user-1', { mode: 'security', scope: 'single_file', fileIds: ['src/app.ts'] });

    expect(review.status).toBe('completed');
    expect(review.summary).toBe('Found one issue.');
    expect(review.issues).toHaveLength(1);
    expect(review.issues[0].severity).toBe('critical');
    expect(review.generalRecommendations).toEqual(['Add a linter rule for this.']);
  });

  it('coerces an unrecognized severity to "medium" instead of dropping the issue', async () => {
    const reviewRepo = makeReviewRepo();
    const filesService = makeFilesService([{ relativePath: 'src/app.ts' }]);
    const aiProvidersService = makeAiProvidersService(async () => ({
      content: JSON.stringify({
        summary: 'ok',
        issues: [{ title: 'X', description: 'Y', severity: 'super-duper-bad' }],
      }),
      model: 'test-model',
    }));

    const service = new ReviewsService(reviewRepo, makeIssueRepo(), filesService, aiProvidersService);
    const review = await service.create('project-1', 'user-1', { mode: 'quality', scope: 'single_file', fileIds: ['src/app.ts'] });

    expect(review.issues[0].severity).toBe('medium');
  });

  it('strips accidental markdown code fences before parsing JSON', async () => {
    const reviewRepo = makeReviewRepo();
    const filesService = makeFilesService([{ relativePath: 'src/app.ts' }]);
    const aiProvidersService = makeAiProvidersService(async () => ({
      content: '```json\n' + JSON.stringify({ summary: 'fenced', issues: [] }) + '\n```',
      model: 'test-model',
    }));

    const service = new ReviewsService(reviewRepo, makeIssueRepo(), filesService, aiProvidersService);
    const review = await service.create('project-1', 'user-1', { mode: 'quality', scope: 'single_file', fileIds: ['src/app.ts'] });

    expect(review.summary).toBe('fenced');
  });

  it('persists a failed review with a friendly message when every context tier is rejected as too large', async () => {
    const reviewRepo = makeReviewRepo();
    const filesService = makeFilesService([{ relativePath: 'src/app.ts' }]);
    const aiProvidersService = makeAiProvidersService(async () => {
      throw new AiProviderError('too big', 'context_too_large');
    });

    const service = new ReviewsService(reviewRepo, makeIssueRepo(), filesService, aiProvidersService);
    const review = await service.create('project-1', 'user-1', { mode: 'quality', scope: 'single_file', fileIds: ['src/app.ts'] });

    expect(review.status).toBe('failed');
    expect(review.errorMessage).toMatch(/too large/i);
    expect(review.issues).toEqual([]);
  });

  it('rejects a multi-file scope request with no fileIds before ever calling the AI provider', async () => {
    const reviewRepo = makeReviewRepo();
    const filesService = makeFilesService([{ relativePath: 'src/app.ts' }]);
    const aiProvidersService = makeAiProvidersService(async () => ({ content: '{}', model: 'test-model' }));

    const service = new ReviewsService(reviewRepo, makeIssueRepo(), filesService, aiProvidersService);
    await expect(service.create('project-1', 'user-1', { mode: 'quality', scope: 'multi_file' } as any)).rejects.toThrow();
    expect(aiProvidersService.resolveClient).not.toHaveBeenCalled();
  });
});
