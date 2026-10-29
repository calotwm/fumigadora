import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidFileKeyError, readStoredFile, resolveFilePath, storedFileSize, writeStoredFile } from '../services/files.js';

describe('file storage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fumigadora-files-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes and reads a file, creating directories', async () => {
    await writeStoredFile(dir, 'certificates/1.pdf', Buffer.from('%PDF-test'));
    expect((await readStoredFile(dir, 'certificates/1.pdf'))?.toString()).toBe('%PDF-test');
    expect(await readFile(join(dir, 'certificates', '1.pdf'), 'utf8')).toBe('%PDF-test');
    expect(await storedFileSize(dir, 'certificates/1.pdf')).toBe(9);
  });

  it('returns null for a missing file', async () => {
    expect(await readStoredFile(dir, 'certificates/none.pdf')).toBeNull();
    expect(await storedFileSize(dir, 'certificates/none.pdf')).toBeNull();
  });

  it.each(['../escape.pdf', 'a/../../escape.pdf', '/etc/passwd', '\\windows\\x.pdf', 'C:\\x.pdf', 'a\\..\\..\\x.pdf', '', 'a\0b'])(
    'rejects the key %j',
    async (key) => {
      expect(() => resolveFilePath(dir, key)).toThrow(InvalidFileKeyError);
      await expect(writeStoredFile(dir, key, Buffer.from('x'))).rejects.toThrow(InvalidFileKeyError);
    },
  );
});
