/** Extensions we treat as text/source and will index, preview, and send to
 *  AI providers. Anything else is stored but flagged binary and excluded
 *  from AI context to avoid wasting tokens / corrupting prompts. */
export const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx',
  '.py', '.java', '.go', '.rb', '.php', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.html', '.css', '.scss', '.less', '.yml', '.yaml', '.toml', '.xml',
  '.sql', '.sh', '.env.example', '.txt', '.gitignore', '.dockerfile',
  '.prisma', '.graphql', '.vue', '.svelte', '.kt', '.rs', '.swift',
]);

/** Never extracted/stored — keeps junk and noise out of the code explorer
 *  and out of AI review context. */
export const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.next', '.idea', '.vscode', '.DS_Store',
]);

export const MAX_FILES_PER_UPLOAD = 2000;
export const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024; // 5MB per file
