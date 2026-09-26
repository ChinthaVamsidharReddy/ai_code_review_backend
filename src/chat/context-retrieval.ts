import { CodeFile } from '../files/code-file.entity';

export interface ScoredFile {
  file: CodeFile;
  score: number;
}

/**
 * Simple, dependency-free relevance retrieval: scores each candidate file
 * by keyword overlap between the question and (a) its path/filename and
 * (b) its content, then returns the top-K. This is intentionally not a
 * vector-embedding/RAG pipeline — it's a clear seam. Swapping this function
 * for an embeddings-backed retriever later doesn't require touching
 * ChatService or anything upstream of it.
 */
export function retrieveRelevantFiles(
  question: string,
  files: { file: CodeFile; content: string }[],
  topK = 6,
): ScoredFile[] {
  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9_\s./-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) {
    return files.slice(0, topK).map((f) => ({ file: f.file, score: 0 }));
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
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
