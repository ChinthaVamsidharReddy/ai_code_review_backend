import * as AdmZip from 'adm-zip';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FilesService } from '../files.service';

describe('FilesService zip safety', () => {
  let tmpRoot: string;
  let repo: any;
  let configService: any;
  let service: FilesService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-code-review-test-'));
    repo = {
      create: jest.fn((v) => v),
      save: jest.fn((entities) => Promise.resolve(entities)),
      delete: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    configService = { get: jest.fn().mockReturnValue(tmpRoot) };
    service = new FilesService(repo, configService);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects path traversal entries and never writes outside the project directory', async () => {
    const zip = new AdmZip();
    zip.addFile('../../etc/evil.txt', Buffer.from('should never land here'));
    zip.addFile('src/index.ts', Buffer.from('console.log("safe file")'));

    const saved = await service.ingestZip('project-1', zip.toBuffer());

    // Only the safe file should have been persisted...
    expect(saved.map((f) => f.relativePath)).toEqual(['src/index.ts']);

    // ...and nothing should exist outside the project's own storage directory.
    const escapedPath = path.resolve(tmpRoot, '..', 'etc', 'evil.txt');
    await expect(fs.access(escapedPath)).rejects.toThrow();
  });

  it('rejects an invalid (non-zip) archive', async () => {
    await expect(service.ingestZip('project-1', Buffer.from('not a real zip file'))).rejects.toThrow();
  });

  it('rejects an empty archive', async () => {
    const zip = new AdmZip();
    await expect(service.ingestZip('project-1', zip.toBuffer())).rejects.toThrow();
  });

  it('skips ignored directories like node_modules and .git', async () => {
    const zip = new AdmZip();
    zip.addFile('node_modules/pkg/index.js', Buffer.from('noise'));
    zip.addFile('.git/config', Buffer.from('noise'));
    zip.addFile('src/app.ts', Buffer.from('real code'));

    const saved = await service.ingestZip('project-1', zip.toBuffer());
    expect(saved.map((f) => f.relativePath)).toEqual(['src/app.ts']);
  });
});
