import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../passwords.js';

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('correct horsE', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('uses a per-password salt and never stores the plain text', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('same');
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  it('never matches malformed or dummy hashes', async () => {
    expect(await verifyPassword('x', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$a$b')).toBe(false);
    expect(await verifyPassword('x', DUMMY_HASH)).toBe(false);
  });
});
