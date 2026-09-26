import { ReviewMode } from './review.entity';

/** Mode-specific instructions. Kept separate from the shared schema/output
 *  contract in buildSystemPrompt() so each mode stays focused and it's easy
 *  to add a fourth mode later without touching the others. */
const MODE_FOCUS: Record<ReviewMode, string> = {
  security: `You are reviewing this code for SECURITY problems only. Focus specifically on:
- Hardcoded credentials, API keys, or secrets
- Authentication and session-handling weaknesses
- Authorization / access-control gaps (missing ownership checks, IDOR)
- Missing or weak input validation
- Injection risks (SQL, command, path traversal, template injection)
- Unsafe handling of sensitive data (logging secrets, weak hashing, plaintext storage)
Ignore purely stylistic or performance concerns unless they also create a security risk.`,

  performance: `You are reviewing this code for PERFORMANCE problems only. Focus specifically on:
- Inefficient algorithms or data structures (e.g. O(n^2) where O(n) is possible)
- Unnecessary or repeated database queries (N+1 patterns, missing indexes/pagination)
- Expensive synchronous operations on hot paths
- Inefficient rendering or unnecessary re-computation
- Resource-management issues (unclosed connections, memory growth, unbounded caches)
Ignore purely stylistic or security concerns unless they also create a performance risk.`,

  quality: `You are reviewing this code for CODE QUALITY only. Focus specifically on:
- Naming clarity and consistency
- Structure, module boundaries, and separation of concerns
- Readability and maintainability
- Duplication
- Error handling completeness and consistency
- Overall design quality
Ignore security and performance concerns unless they also significantly harm maintainability.`,
};

const OUTPUT_CONTRACT = `Respond with a single JSON object and nothing else — no markdown fences, no prose before or after. Use exactly this shape:
{
  "summary": "2-4 sentence high-level overview of what you found",
  "issues": [
    {
      "title": "short issue title",
      "description": "what the problem is and why it matters",
      "severity": "critical" | "high" | "medium" | "low",
      "filePath": "path of the file this issue is in, or null if project-wide",
      "lineHint": "approximate location, e.g. 'near the loginUser function', or null",
      "recommendation": "concrete suggested fix"
    }
  ],
  "generalRecommendations": ["optional higher-level suggestions not tied to one specific issue"]
}

Rules:
- Only report real, meaningful findings. If you find nothing significant for this review mode, return an empty "issues" array rather than inventing minor nitpicks.
- Use "critical" only for issues that are immediately exploitable or would cause data loss/outage; use it sparingly.
- Every issue must include a concrete, actionable "recommendation".
- Prefer fewer, well-explained issues over a long list of noise.`;

export function buildSystemPrompt(mode: ReviewMode): string {
  return `${MODE_FOCUS[mode]}\n\n${OUTPUT_CONTRACT}`;
}

export interface FileForReview {
  path: string;
  content: string;
  truncated?: boolean;
}

export function buildUserPrompt(files: FileForReview[], scopeLabel: string): string {
  const fileBlocks = files
    .map((f) => `### File: ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `Review scope: ${scopeLabel}\nNumber of files: ${files.length}\n\n${fileBlocks}`;
}
