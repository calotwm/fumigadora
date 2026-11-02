// Helpers for multipart upload tests.
import type { TestApp } from './helpers.js';

/** Smallest bytes that look like each format (magic numbers only). */
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
export const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
export const PDF = Buffer.from('%PDF-1.4 invented');

export async function login(t: TestApp, username: string, password: string) {
  const res = await t.app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

export function form(fields: Record<string, string | { bytes: Buffer; type: string; name: string }>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') data.set(key, value);
    else data.set(key, new File([new Uint8Array(value.bytes)], value.name, { type: value.type }));
  }
  return data;
}

export async function send(t: TestApp, cookie: string, method: string, path: string, body?: FormData) {
  const res = await t.app.request(path, { method, headers: { cookie }, ...(body ? { body } : {}) });
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed: any = isJson ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: parsed };
}
