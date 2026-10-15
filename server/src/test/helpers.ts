import { createApp } from '../app.js';
import type { Config } from '../config.js';
import { createDb } from '../db/client.js';
import { createSimulatedProvider, type MailProvider } from '../mail/provider.js';

export const TEST_PASSWORD = 'test-password';

export const testConfig: Config = {
  isProduction: false,
  port: 0,
  databaseUrl: undefined,
  pgliteDir: 'memory://',
  adminPassword: TEST_PASSWORD,
  sessionSecret: 'test-secret-test-secret-test-secret-1234',
  sessionTtlSeconds: 3600,
  mail: { resendApiKey: undefined, from: undefined, replyTo: undefined },
};

export interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** In-memory PGlite + migrations + app with a fixed, changeable "today". */
export async function makeTestApp(initialToday = '2025-06-15', mail: MailProvider = createSimulatedProvider()) {
  const handle = createDb(); // memory://
  await handle.migrate();
  const state = { today: initialToday };
  const app = createApp({ db: handle.db, config: testConfig, today: () => state.today, serveWeb: false, mail });

  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: TEST_PASSWORD }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  async function call(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const res = await app.request(path, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  return {
    app,
    mail,
    config: testConfig,
    db: handle.db,
    today: () => state.today,
    cookie,
    call,
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    patch: (path: string, body: unknown) => call('PATCH', path, body),
    del: (path: string) => call('DELETE', path),
    setToday: (d: string) => {
      state.today = d;
    },
    close: () => handle.close(),
  };
}

export type TestApp = Awaited<ReturnType<typeof makeTestApp>>;
