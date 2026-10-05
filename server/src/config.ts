const isProduction = process.env.NODE_ENV === 'production';

const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me-0123456789';

export interface Config {
  isProduction: boolean;
  port: number;
  databaseUrl: string | undefined;
  /** Directory for the embedded PGlite database when no DATABASE_URL is set. */
  pgliteDir: string;
  adminPassword: string;
  sessionSecret: string;
  /** Session lifetime in seconds. */
  sessionTtlSeconds: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const prod = env.NODE_ENV === 'production' || isProduction;
  let adminPassword = env.ADMIN_PASSWORD;
  let sessionSecret = env.SESSION_SECRET;

  if (!adminPassword) {
    if (prod) throw new Error('ADMIN_PASSWORD is required in production');
    console.warn('[config] ADMIN_PASSWORD not set: using insecure development default "admin"');
    adminPassword = 'admin';
  }
  if (!sessionSecret) {
    if (prod) throw new Error('SESSION_SECRET is required in production');
    console.warn('[config] SESSION_SECRET not set: using insecure development default');
    sessionSecret = DEV_SESSION_SECRET;
  }

  return {
    isProduction: prod,
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR ?? './.data/pglite',
    adminPassword,
    sessionSecret,
    sessionTtlSeconds: 60 * 60 * 24 * 30,
  };
}
