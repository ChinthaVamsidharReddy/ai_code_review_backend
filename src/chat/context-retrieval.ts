import { CodeFile } from '../files/code-file.entity';

export interface ScoredFile {
  file: CodeFile;
  score: number;
}

/** Generic words that appear in almost every file/question and would
 *  otherwise "match" everywhere, silently pulling irrelevant files (and
 *  their full content) into the AI request. This was the direct cause of
 *  "what's the project name" — a fully generic question — still triggering
 *  a large multi-file request: "project" and "name" both show up in most
 *  package.json / README files regardless of actual relevance. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has',
  'was', 'were', 'this', 'that', 'with', 'from', 'what', 'how', 'does',
  'about', 'have', 'name', 'project', 'file', 'files', 'code', 'tell',
  'please', 'just', 'give', 'show', 'me', 'app', 'application', 'single',
  'line', 'one', 'get', 'its', "it's", 'which', 'who', 'where', 'when',
  'why', 'there', 'their', 'they', 'them', 'these', 'those', 'here',
]);

/** Minimum score a file needs before it's considered genuinely relevant
 *  (rather than an incidental keyword overlap). Below this, no files are
 *  returned at all — the caller falls back to a near-zero-cost "project
 *  overview" answer instead of dragging in weakly-related file content. */
const RELEVANCE_THRESHOLD = 4;

/**
 * Simple, dependency-free relevance retrieval: scores each candidate file
 * by keyword overlap between the question and (a) its path/filename and
 * (b) its content, then returns the top-K genuinely-relevant files. This is
 * intentionally not a vector-embedding/RAG pipeline — it's a clear seam.
 * Swapping this function for an embeddings-backed retriever later doesn't
 * require touching ChatService or anything upstream of it.
 *
 * Deliberately returns an EMPTY array (rather than "just give me some
 * files") when nothing scores meaningfully above the noise floor — a
 * generic or off-topic question should cost almost nothing to answer, not
 * silently attach several files' worth of content.
 */
export function retrieveRelevantFiles(
  question: string,
  files: { file: CodeFile; content: string }[],
  topK = 4,
): ScoredFile[] {
  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9_\s./-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  if (keywords.length === 0) {
    return [];
  }

  const scored: ScoredFile[] = files.map(({ file, content }) => {
    const haystack = `${file.relativePath.toLowerCase()}\n${content.toLowerCase()}`;
    let score = 0;
    for (const kw of keywords) {
      // Filename/path matches weigh far more than a stray body match.
      if (file.relativePath.toLowerCase().includes(kw)) score += 5;
      const occurrences = haystack.split(kw).length - 1;
      score += Math.min(occurrences, 10); // cap so one huge file doesn't dominate
    }
    return { file, score };
  });

  return scored
    .filter((s) => s.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
