import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig in production', () => {
  it('refuses to boot without ADMIN_PASSWORD', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32) })).toThrow(/ADMIN_PASSWORD/);
  });

  it('refuses to boot without SESSION_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'secret' })).toThrow(/SESSION_SECRET/);
  });

  it('boots with both secrets and reads PORT and DATABASE_URL', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'secret',
      SESSION_SECRET: 's'.repeat(32),
      PORT: '8080',
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
    });
    expect(config).toMatchObject({ isProduction: true, port: 8080, databaseUrl: 'postgres://user:pass@host:5432/db' });
  });

  it('falls back to warned development defaults outside production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadConfig({});
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
