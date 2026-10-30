import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { AppError, badRequest, errorBody } from '../http.js';

/** Largest file accepted by any upload. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const PDF_TYPES = ['application/pdf'] as const;
export type UploadType = (typeof IMAGE_TYPES)[number] | (typeof PDF_TYPES)[number];

const EXTENSIONS: Record<UploadType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Media type read from the file's first bytes; the type the browser declares is never trusted. */
export function sniffType(bytes: Uint8Array): UploadType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'image/heic';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function extensionOf(type: UploadType): string {
  return EXTENSIONS[type];
}

/**
 * Rejects bodies over the upload limit before they are read into memory (`413`). The margin covers the multipart
 * envelope and the other form fields; the file itself is checked again in `readUpload`.
 */
export function uploadLimit(): MiddlewareHandler {
  return bodyLimit({
    maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
    onError: (c) => c.json(errorBody('file_too_large', 'El archivo supera los 10 MB'), 413),
  });
}

export interface Upload {
  bytes: Uint8Array;
  type: UploadType;
  ext: string;
}

/** Text fields of a multipart body plus its files, keyed by field name. */
export async function readForm(c: Context) {
  const body = await c.req.parseBody();
  const fields: Record<string, string> = {};
  const files: Record<string, File> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') fields[key] = value;
    else if (value instanceof File) files[key] = value;
  }
  return { fields, files };
}

/**
 * Validates one uploaded file: present (unless `optional`), at most 10 MB, and its bytes are one of `allowed`.
 * `missing` and `wrongType` are the user-facing messages.
 */
export async function checkUpload(
  file: File | undefined,
  allowed: readonly UploadType[],
  messages: { missing: string; wrongType: string },
): Promise<Upload> {
  if (!file || file.size === 0) throw badRequest(messages.missing);
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, 'file_too_large', 'El archivo supera los 10 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !allowed.includes(type)) throw badRequest(messages.wrongType, 'invalid_file');
  return { bytes, type, ext: extensionOf(type) };
}

/** Parses text form fields with zod, answering with the standard validation error body. */
export function parseFields<T extends z.ZodType>(schema: T, fields: Record<string, string>): z.infer<T> {
  const result = schema.safeParse(fields);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'validation', 'Datos inválidos', { issues });
  }
  return result.data;
}

/** Response serving a stored file to the browser, never cached by shared caches. */
export function fileResponse(c: Context, bytes: Uint8Array, type: string, name: string) {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': type,
    'content-disposition': `inline; filename="${safe}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
}
