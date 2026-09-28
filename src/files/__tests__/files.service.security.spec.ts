import * as AdmZip from 'adm-zip';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FilesService } from '../files.service';

/**
 * Hand-rolled, minimal STORED (uncompressed) ZIP writer used ONLY to build
 * test fixtures with a genuinely unsanitized entry name.
 *
 * This exists because `AdmZip`'s own public `addFile()` API sanitizes
 * traversal segments out of an entry name via its internal `zipnamefix()`
 * before the name is ever written into the archive bytes (confirmed by
 * inspecting adm-zip's source: `addFile()` calls `zipnamefix(entryName)`
 * as its very first line). A fixture built with `new AdmZip().addFile('../../etc/evil.txt', ...)`
 * therefore can never actually contain a `..` segment by the time
 * `ingestZip()` reads it back — it silently becomes a harmless
 * `etc/evil.txt`, and a test asserting that entry gets REJECTED would be
 * asserting something that was never actually exercised: AdmZip's own
 * write-time sanitization did the work, not our code's read-time defenses.
 *
 * A real malicious archive (crafted by hand, or written by a different
 * zip library/language that doesn't sanitize on write — which is the
 * entire premise of the "zip-slip" vulnerability class) has no such
 * protection. This builder produces exactly that: raw central-directory
 * entries with literal, unsanitized names, so the tests below actually
 * exercise FilesService's own path-traversal defenses (`safeResolve()`
 * and the `..`-segment filter in `ingestZip()`), independent of whatever
 * protection AdmZip happens to also provide.
 */
function crc32(buf: Buffer): number {
  let table = crc32Table;
  if (!table) {
    table = crc32Table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
let crc32Table: Uint32Array | undefined;

function buildRawZip(entries: { name: string; content: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // STORED (no compression)
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([local, nameBuf, content]);
    localParts.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));

    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

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

  it('rejects a genuinely unsanitized path-traversal entry and never writes outside the project directory', async () => {
    const zipBuffer = buildRawZip([
      { name: '../../etc/evil.txt', content: Buffer.from('should never land here') },
      { name: 'src/index.ts', content: Buffer.from('console.log("safe file")') },
    ]);

    const saved = await service.ingestZip('project-1', zipBuffer);

    // Only the safe file should have been persisted...
    expect(saved.map((f) => f.relativePath)).toEqual(['src/index.ts']);

    // ...and nothing should exist outside the project's own storage directory.
    const escapedPath = path.resolve(tmpRoot, '..', 'etc', 'evil.txt');
    await expect(fs.access(escapedPath)).rejects.toThrow();
  });

  it('rejects a traversal segment embedded after a legitimate-looking prefix', async () => {
    // A common zip-slip bypass attempt: the entry LOOKS like it's inside
    // the archive ("src/...") but still climbs out via an embedded "..".
    const zipBuffer = buildRawZip([
      { name: 'src/../../../etc/evil.txt', content: Buffer.from('should never land here either') },
      { name: 'src/index.ts', content: Buffer.from('console.log("safe file")') },
    ]);

    const saved = await service.ingestZip('project-1', zipBuffer);
    expect(saved.map((f) => f.relativePath)).toEqual(['src/index.ts']);
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
