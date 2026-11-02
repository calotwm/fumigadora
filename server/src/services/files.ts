import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

/** Thrown for keys that are absolute or would resolve outside the files directory. */
export class InvalidFileKeyError extends Error {
  constructor(key: string) {
    super(`Invalid file key: ${key}`);
  }
}

/** Resolves a relative key inside `baseDir`, rejecting absolute paths, `..` segments and NUL bytes. */
export function resolveFilePath(baseDir: string, key: string): string {
  if (key === '' || key.includes('\0') || isAbsolute(key) || /^[\\/]/.test(key) || /^[a-zA-Z]:/.test(key)) {
    throw new InvalidFileKeyError(key);
  }
  if (key.split(/[\\/]/).includes('..')) throw new InvalidFileKeyError(key);
  const base = resolve(baseDir);
  const full = resolve(base, key);
  if (!full.startsWith(base + sep)) throw new InvalidFileKeyError(key);
  return full;
}

/** Writes `data` under `key`, creating parent directories. */
export async function writeStoredFile(baseDir: string, key: string, data: Uint8Array): Promise<void> {
  const full = resolveFilePath(baseDir, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
}

/** Reads the file stored under `key`, or null when it does not exist. */
export async function readStoredFile(baseDir: string, key: string): Promise<Buffer | null> {
  const full = resolveFilePath(baseDir, key);
  try {
    return await readFile(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Size in bytes of the stored file, or null when it does not exist. */
export async function storedFileSize(baseDir: string, key: string): Promise<number | null> {
  const full = resolveFilePath(baseDir, key);
  try {
    return (await stat(full)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Removes the file stored under `key`; a missing file is not an error. */
export async function deleteStoredFile(baseDir: string, key: string): Promise<void> {
  await rm(resolveFilePath(baseDir, key), { force: true });
}
