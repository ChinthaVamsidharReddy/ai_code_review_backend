import { CodeFile } from '../files/code-file.entity';
import { FileForReview } from './review-templates';

/**
 * Keeps AI prompts within a sane size instead of blindly concatenating an
 * entire repository. Character counts are a cheap proxy for tokens
 * (~4 chars/token) that avoids pulling in a tokenizer dependency for an
 * assessment-scale project; documented as a trade-off in AI_USAGE.md.
 *
 * IMPORTANT: this is intentionally NOT a single fixed budget. Free-tier
 * OpenAI-compatible providers (Groq's free tier is the primary case this
 * was tuned against) frequently cap total request size well below what a
 * paid OpenAI plan allows — sometimes only a few thousand tokens. A single
 * generous budget that works fine on GPT-4-class context windows will
 * reliably produce "request too large" errors on those providers. Instead,
 * every AI-calling module tries a small ladder of progressively smaller
 * budgets (see BudgetTier below) and only moves to the next, smaller tier
 * when the provider actually rejects the request as too large — see
 * `ai-providers/with-resilience.ts` for the retry orchestration that pairs
 * with this.
 */
export interface BudgetTier {
  label: string;
  maxTotalChars: number;
  maxCharsPerFile: number;
}

/** Tuned for code review: reviews benefit from breadth (seeing more of the
 *  project), so the top tier is larger, but every tier is still small
 *  enough to fit comfortably inside typical free-tier request limits
 *  (roughly 2.5k / 5k / 10k tokens respectively, at ~4 chars/token). */
export const REVIEW_BUDGET_TIERS: BudgetTier[] = [
  { label: 'standard', maxTotalChars: 10_000, maxCharsPerFile: 2_500 },
  { label: 'reduced', maxTotalChars: 5_000, maxCharsPerFile: 1_500 },
  { label: 'minimal', maxTotalChars: 2_500, maxCharsPerFile: 800 },
];

/** Chat answers are usually about one specific thing, not the whole
 *  project, so the ceiling is much lower than review's — a huge context
 *  isn't just wasteful here, it's *why* a one-line question was failing. */
export const CHAT_BUDGET_TIERS: BudgetTier[] = [
  { label: 'standard', maxTotalChars: 4_000, maxCharsPerFile: 1_500 },
  { label: 'minimal', maxTotalChars: 1_800, maxCharsPerFile: 700 },
];

/** Documentation generation needs breadth across many files but not much
 *  depth in any one of them (READMEs/setup guides mostly need to see
 *  imports, exports, config, and structure, not full implementations). */
export const DOCS_BUDGET_TIERS: BudgetTier[] = [
  { label: 'standard', maxTotalChars: 8_000, maxCharsPerFile: 1_500 },
  { label: 'reduced', maxTotalChars: 4_000, maxCharsPerFile: 900 },
  { label: 'minimal', maxTotalChars: 2_000, maxCharsPerFile: 500 },
];

export interface BuiltContext {
  files: FileForReview[];
  skippedFileCount: number;
}

/** True when every candidate came back empty — the signal that on-disk
 *  storage is missing for these files (see FilesService.getFileContent's
 *  `missing` flag) even though their database rows exist. Callers use this
 *  to fail with a clear, actionable message instead of silently sending an
 *  AI provider a request full of empty file bodies, which would produce a
 *  useless or misleading review/answer rather than an obvious error. */
export function allContentMissing(candidates: { path: string; content: string }[]): boolean {
  return candidates.length > 0 && candidates.every((c) => c.content.trim().length === 0);
}


/**
 * Given a set of (path, content) pairs already loaded from disk (in
 * priority order), produces the subset — and per-file truncation — that
 * fits the given budget tier. Defaults to the most conservative review
 * tier if no tier is given, so any caller that forgets to pass one fails
 * safe (small request) rather than failing large.
 */
export function buildReviewContext(
  candidates: { path: string; content: string }[],
  tier: BudgetTier = REVIEW_BUDGET_TIERS[REVIEW_BUDGET_TIERS.length - 1],
): BuiltContext {
  const files: FileForReview[] = [];
  let budget = tier.maxTotalChars;
  let skipped = 0;

  for (const candidate of candidates) {
    if (budget <= 0) {
      skipped++;
      continue;
    }
    const allowance = Math.min(tier.maxCharsPerFile, budget);
    const truncated = candidate.content.length > allowance;
    const content = truncated ? candidate.content.slice(0, allowance) : candidate.content;
    files.push({ path: candidate.path, content, truncated });
    budget -= content.length;
  }

  return { files, skippedFileCount: skipped };
}

/** Orders files so the most "review-worthy" ones are prioritized when a
 *  project is too large to fit in the context budget entirely: source
 *  files before config/markdown, then smaller files first (cheap to
 *  include fully rather than truncated). */
export function prioritizeFiles(files: CodeFile[]): CodeFile[] {
  const sourceExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rb', '.php', '.cs', '.cpp', '.c']);
  return [...files]
    .filter((f) => !f.isBinary)
    .sort((a, b) => {
      const aSource = sourceExt.has(a.extension || '') ? 0 : 1;
      const bSource = sourceExt.has(b.extension || '') ? 0 : 1;
      if (aSource !== bSource) return aSource - bSource;
      return a.sizeBytes - b.sizeBytes;
    });
}
