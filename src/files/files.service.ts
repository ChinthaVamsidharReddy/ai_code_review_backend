import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as AdmZip from 'adm-zip';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeFile } from './code-file.entity';
import { TreeNode } from './dto/tree-node.dto';
import { IGNORED_DIR_NAMES, MAX_FILES_PER_UPLOAD, MAX_SINGLE_FILE_BYTES, TEXT_EXTENSIONS } from './files.constants';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(CodeFile) private readonly repo: Repository<CodeFile>,
    private readonly configService: ConfigService,
  ) {}

  private storageRoot(): string {
    return path.resolve(this.configService.get<string>('storage.root') as string);
  }

  private projectDir(projectId: string): string {
    return path.join(this.storageRoot(), projectId);
  }

  /**
   * Resolves `relativePath` against `baseDir` and asserts the result is
   * still inside `baseDir`. This is the single choke point that prevents
   * zip-slip / path traversal, both on upload (zip entry names) and on
   * every later read (file content, preview, AI context).
   */
  private safeResolve(baseDir: string, relativePath: string): string {
    const resolvedBase = path.resolve(baseDir);
    const target = path.resolve(resolvedBase, relativePath);
    if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
      throw new BadRequestException(`Unsafe path rejected: ${relativePath}`);
    }
    return target;
  }

  /**
   * Extracts an uploaded ZIP into the project's storage directory.
   * Safety measures:
   *  - every entry name is normalized and checked with safeResolve()
   *    before it is ever written to disk (blocks "../../etc/passwd",
   *    absolute paths, and symlink-style tricks in the entry name).
   *  - known junk directories (node_modules, .git, ...) are skipped.
   *  - per-file and per-archive limits prevent zip-bomb style abuse.
   */
  async ingestZip(projectId: string, zipBuffer: Buffer): Promise<CodeFile[]> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new BadRequestException('The uploaded file is not a valid ZIP archive');
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    if (entries.length === 0) {
      throw new BadRequestException('The uploaded ZIP archive is empty');
    }
    if (entries.length > MAX_FILES_PER_UPLOAD) {
      throw new BadRequestException(`Archive contains too many files (max ${MAX_FILES_PER_UPLOAD})`);
    }

    const baseDir = this.projectDir(projectId);
    await fs.mkdir(baseDir, { recursive: true });

    const saved: CodeFile[] = [];
    for (const entry of entries) {
      const normalized = entry.entryName.split('\\').join('/');
      const segments = normalized.split('/').filter(Boolean);

      // Skip anything inside a junk/ignored directory at any depth.
      if (segments.some((seg) => IGNORED_DIR_NAMES.has(seg))) continue;
      if (segments.some((seg) => seg === '..')) continue; // belt & suspenders

      const relativePath = segments.join('/');
      if (!relativePath) continue;

      const data = entry.getData();
      if (data.length > MAX_SINGLE_FILE_BYTES) {
        this.logger.warn(`Skipping oversized file ${relativePath} (${data.length} bytes)`);
        continue;
      }

      const destination = this.safeResolve(baseDir, relativePath); // throws on traversal attempt
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, data);

      const extension = path.extname(relativePath).toLowerCase();
      const isBinary = !TEXT_EXTENSIONS.has(extension) && !this.looksLikeText(data);

      const codeFile = this.repo.create({
        projectId,
        relativePath,
        fileName: path.basename(relativePath),
        extension: extension || undefined,
        sizeBytes: data.length,
        isBinary,
      });
      saved.push(codeFile);
    }

    if (saved.length === 0) {
      throw new BadRequestException('No usable files found in archive after filtering ignored directories');
    }

    // Replace any previous file set for this project (re-upload semantics).
    await this.repo.delete({ projectId });
    return this.repo.save(saved);
  }

  async buildTree(projectId: string): Promise<TreeNode[]> {
    const files = await this.repo.find({ where: { projectId }, order: { relativePath: 'ASC' } });
    const root: TreeNode[] = [];

    for (const file of files) {
      const segments = file.relativePath.split('/');
      let level = root;
      let currentPath = '';

      segments.forEach((segment, index) => {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const isLeaf = index === segments.length - 1;

        let node = level.find((n) => n.name === segment && n.type === (isLeaf ? 'file' : 'folder'));
        if (!node) {
          node = isLeaf
            ? { name: segment, path: currentPath, type: 'file', sizeBytes: file.sizeBytes, fileId: file.id, isBinary: file.isBinary }
            : { name: segment, path: currentPath, type: 'folder', children: [] };
          level.push(node);
        }
        if (!isLeaf) level = node.children as TreeNode[];
      });
    }
    return root;
  }

  async getFileContent(projectId: string, fileId: string): Promise<{ file: CodeFile; content: string | null }> {
    const file = await this.repo.findOne({ where: { id: fileId, projectId } });
    if (!file) throw new NotFoundException('File not found');
    if (file.isBinary) return { file, content: null };

    const baseDir = this.projectDir(projectId);
    const fullPath = this.safeResolve(baseDir, file.relativePath);
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => null);
    return { file, content };
  }

  async getFilesByIds(projectId: string, fileIds: string[]): Promise<CodeFile[]> {
    if (fileIds.length === 0) return [];
    return this.repo
      .createQueryBuilder('f')
      .where('f.projectId = :projectId', { projectId })
      .andWhere('f.id IN (:...fileIds)', { fileIds })
      .getMany();
  }

  async getAllProjectFiles(projectId: string): Promise<CodeFile[]> {
    return this.repo.find({ where: { projectId } });
  }

  async readFileText(projectId: string, file: CodeFile): Promise<string | null> {
    if (file.isBinary) return null;
    const baseDir = this.projectDir(projectId);
    const fullPath = this.safeResolve(baseDir, file.relativePath);
    return fs.readFile(fullPath, 'utf-8').catch(() => null);
  }

  private looksLikeText(buffer: Buffer): boolean {
    const sample = buffer.subarray(0, 1000);
    let suspicious = 0;
    for (const byte of sample) {
      if (byte === 0) return false; // NUL byte => binary
      if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
    }
    return suspicious / Math.max(sample.length, 1) < 0.05;
  }
}
