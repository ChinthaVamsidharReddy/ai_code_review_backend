import { allContentMissing, buildReviewContext, REVIEW_BUDGET_TIERS } from '../context-builder';

describe('buildReviewContext', () => {
  it('includes every file when they all fit within the tier budget', () => {
    const { files, skippedFileCount } = buildReviewContext(
      [
        { path: 'a.ts', content: 'short content' },
        { path: 'b.ts', content: 'also short' },
      ],
      { label: 'test', maxTotalChars: 1000, maxCharsPerFile: 500 },
    );
    expect(files).toHaveLength(2);
    expect(files.every((f) => !f.truncated)).toBe(true);
    expect(skippedFileCount).toBe(0);
  });

  it('truncates a single file that exceeds the per-file cap and flags it', () => {
    const { files } = buildReviewContext(
      [{ path: 'big.ts', content: 'x'.repeat(1000) }],
      { label: 'test', maxTotalChars: 5000, maxCharsPerFile: 100 },
    );
    expect(files[0].content).toHaveLength(100);
    expect(files[0].truncated).toBe(true);
  });

  it('drops files entirely once the total budget is exhausted, counting them as skipped', () => {
    const { files, skippedFileCount } = buildReviewContext(
      [
        { path: 'a.ts', content: 'x'.repeat(80) },
        { path: 'b.ts', content: 'y'.repeat(80) },
        { path: 'c.ts', content: 'z'.repeat(80) },
      ],
      { label: 'test', maxTotalChars: 150, maxCharsPerFile: 80 },
    );
    // a.ts (80) + b.ts (70 of remaining 70 budget, truncated) exhausts the
    // 150-char total budget; c.ts should be skipped entirely.
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(skippedFileCount).toBe(1);
  });

  it('defaults to the smallest (most conservative) tier when none is given', () => {
    const { files } = buildReviewContext([{ path: 'a.ts', content: 'x'.repeat(10_000) }]);
    const smallestTier = REVIEW_BUDGET_TIERS[REVIEW_BUDGET_TIERS.length - 1];
    expect(files[0].content.length).toBeLessThanOrEqual(smallestTier.maxCharsPerFile);
  });
});

describe('allContentMissing', () => {
  it('returns true when every candidate has empty content', () => {
    expect(allContentMissing([{ path: 'a.ts', content: '' }, { path: 'b.ts', content: '   ' }])).toBe(true);
  });

  it('returns false when at least one candidate has real content', () => {
    expect(allContentMissing([{ path: 'a.ts', content: '' }, { path: 'b.ts', content: 'const x = 1;' }])).toBe(false);
  });

  it('returns false for an empty candidate list (nothing to flag as missing)', () => {
    expect(allContentMissing([])).toBe(false);
  });
});
