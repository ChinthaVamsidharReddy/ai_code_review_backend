import { CodeFile } from '../files/code-file.entity';
import { FileForReview } from './review-templates';

/** Keeps AI prompts within a sane size instead of blindly concatenating an
 *  entire repository. Character counts are a cheap proxy for tokens
 *  (~4 chars/token) that avoids pulling in a tokenizer dependency for an
 *  assessment-scale project; documented as a trade-off in AI_USAGE.md. */
const MAX_TOTAL_CHARS = 60_000; // ~15k tokens of code context
const MAX_CHARS_PER_FILE = 12_000;

export interface BuiltContext {
  files: FileForReview[];
  skippedFileCount: number;
}

/**
 * Given a set of (path, content) pairs already loaded from disk, produces
 * the subset (and per-file truncation) that fits the context budget.
 * Larger/prioritized files (already ordered by caller) are included first.
 */
export function buildReviewContext(candidates: { path: string; content: string }[]): BuiltContext {
  const files: FileForReview[] = [];
  let budget = MAX_TOTAL_CHARS;
  let skipped = 0;

  for (const candidate of candidates) {
    if (budget <= 0) {
      skipped++;
      continue;
    }
    const allowance = Math.min(MAX_CHARS_PER_FILE, budget);
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
