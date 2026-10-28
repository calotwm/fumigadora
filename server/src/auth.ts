import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { UserRole } from '@fumigadora/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { users } from './db/schema.js';
import { errorBody, v } from './http.js';
import { DUMMY_HASH, verifyPassword } from './passwords.js';

export const SESSION_COOKIE = 'fumigadora_session';

/** Identity attached to every authenticated request. The owner (shared password) has no `userId`. */
export interface Session {
  role: UserRole;
  userId?: number;
  name: string;
}

export type AuthEnv = { Variables: { session: Session } };

const OWNER_NAME = 'Dueño';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time string comparison (hashes first so length differences do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

interface TokenPayload {
  exp: number;
  role: UserRole;
  uid?: number;
}

export function createSessionToken(
  config: Config,
  identity: { role: UserRole; userId?: number } = { role: 'admin' },
  now = Date.now(),
): string {
  const data: TokenPayload = {
    exp: Math.floor(now / 1000) + config.sessionTtlSeconds,
    role: identity.role,
    ...(identity.userId === undefined ? {} : { uid: identity.userId }),
  };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

/** Verifies signature and expiry. Tokens without a role (issued before employee accounts) are rejected. */
export function verifySessionToken(
  config: Config,
  token: string | undefined,
  now = Date.now(),
): { role: UserRole; userId?: number } | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, config.sessionSecret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
    if (data.role !== 'admin' && data.role !== 'employee') return null;
    if (data.role === 'employee' && typeof data.uid !== 'number') return null;
    return { role: data.role, ...(typeof data.uid === 'number' ? { userId: data.uid } : {}) };
  } catch {
    return null;
  }
}

/** Resolves the session from the cookie; accounts that were deactivated lose access immediately. */
async function resolveSession(config: Config, db: Db, token: string | undefined): Promise<Session | null> {
  const identity = verifySessionToken(config, token);
  if (!identity) return null;
  if (identity.userId === undefined) return { role: identity.role, name: OWNER_NAME };
  const [user] = await db.select().from(users).where(eq(users.id, identity.userId));
  if (!user || !user.active) return null;
  return { role: user.role, userId: user.id, name: user.name };
}

export const requireSession =
  (config: Config, db: Db): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const session = await resolveSession(config, db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    c.set('session', session);
    await next();
  };

/** Admin-only guard; must run after `requireSession`. */
export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.get('session').role !== 'admin') {
    return c.json(errorBody('forbidden', 'No tenés permiso para esta acción'), 403);
  }
  await next();
};

/** Naive in-memory throttle: max 8 failed logins per IP per 10 minutes. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;
/** Expired entries are swept once the map reaches this size, so it cannot grow without bound. */
const MAX_TRACKED_KEYS = 1000;

const loginBody = z.object({
  username: z.string().trim().max(100).optional(),
  password: z.string().max(500),
});

export function authRoutes(config: Config, db: Db) {
  const failures = new Map<string, { count: number; first: number }>();
  const app = new Hono<AuthEnv>();

  app.post('/login', v('json', loginBody), async (c) => {
    // Railway's edge sets X-Real-IP to the client address; X-Forwarded-For is client-controlled.
    const key = c.req.header('x-real-ip')?.trim() || 'local';
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_FAILURES) {
      return c.json(errorBody('rate_limited', 'Demasiados intentos. Probá de nuevo en unos minutos.'), 429);
    }
    const { username, password } = c.req.valid('json');

    let identity: { role: UserRole; userId?: number; name: string } | null = null;
    if (!username) {
      // Owner login: shared ADMIN_PASSWORD, no username.
      if (safeEqual(password, config.adminPassword)) identity = { role: 'admin', name: OWNER_NAME };
    } else {
      const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (user && ok && user.active) identity = { role: user.role, userId: user.id, name: user.name };
    }

    if (!identity) {
      if (failures.size >= MAX_TRACKED_KEYS) {
        for (const [k, e] of failures) if (now - e.first >= WINDOW_MS) failures.delete(k);
      }
      const fresh = entry && now - entry.first < WINDOW_MS ? entry : { count: 0, first: now };
      fresh.count += 1;
      failures.set(key, fresh);
      return c.json(
        errorBody('invalid_credentials', username ? 'Usuario o contraseña incorrectos' : 'Contraseña incorrecta'),
        401,
      );
    }
    failures.delete(key);
    setCookie(c, SESSION_COOKIE, createSessionToken(config, identity), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.isProduction,
      path: '/',
      maxAge: config.sessionTtlSeconds,
    });
    return c.json({
      authenticated: true,
      role: identity.role,
      ...(identity.userId === undefined ? {} : { userId: identity.userId }),
      name: identity.name,
    });
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ authenticated: false });
  });

  app.get('/me', async (c) => {
    const session = await resolveSession(config, db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    return c.json({
      authenticated: true,
      role: session.role,
      ...(session.userId === undefined ? {} : { userId: session.userId }),
      name: session.name,
    });
  });

  return app;
}
