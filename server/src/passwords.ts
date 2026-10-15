import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Hashes with scrypt and a per-password random salt. Format: `scrypt$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Constant-time verification; malformed stored hashes never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

/** Hash used to spend the same time when the username does not exist (no user enumeration by timing). */
export const DUMMY_HASH = `scrypt$${Buffer.alloc(SALT_LENGTH).toString('base64')}$${Buffer.alloc(KEY_LENGTH).toString('base64')}`;
