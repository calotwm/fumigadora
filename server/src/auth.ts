import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { SessionRole, UserRole } from '@fumigadora/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { clients, users } from './db/schema.js';
import { errorBody, v } from './http.js';
import { DUMMY_HASH, verifyPassword } from './passwords.js';

export const SESSION_COOKIE = 'fumigadora_session';

/** Client portal sessions last 30 days (the client opens the link from the phone once and stays in). */
export const PORTAL_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Identity attached to every authenticated request. The owner (shared password) has no `userId`.
 * A `client` session carries the `clientId` it is bound to and nothing else.
 */
export interface Session {
  role: SessionRole;
  userId?: number;
  clientId?: number;
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
  role: SessionRole;
  uid?: number;
  /** Client the session is bound to (role `client` only). */
  cid?: number;
}

export interface SessionIdentity {
  role: SessionRole;
  userId?: number;
  clientId?: number;
}

export function createSessionToken(
  config: Config,
  identity: SessionIdentity = { role: 'admin' },
  now = Date.now(),
): string {
  const ttl = identity.role === 'client' ? PORTAL_SESSION_TTL_SECONDS : config.sessionTtlSeconds;
  const data: TokenPayload = {
    exp: Math.floor(now / 1000) + ttl,
    role: identity.role,
    ...(identity.userId === undefined ? {} : { uid: identity.userId }),
    ...(identity.clientId === undefined ? {} : { cid: identity.clientId }),
  };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

/** Verifies signature and expiry. Tokens without a role (issued before employee accounts) are rejected. */
export function verifySessionToken(
  config: Config,
  token: string | undefined,
  now = Date.now(),
): SessionIdentity | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(signature, sign(payload, config.sessionSecret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof data.exp !== 'number' || data.exp * 1000 <= now) return null;
    if (data.role !== 'admin' && data.role !== 'employee' && data.role !== 'client') return null;
    if (data.role === 'employee' && typeof data.uid !== 'number') return null;
    // A client token must name its client and must not double as a staff identity.
    if (data.role === 'client') {
      return typeof data.cid === 'number' && data.uid === undefined ? { role: 'client', clientId: data.cid } : null;
    }
    return { role: data.role, ...(typeof data.uid === 'number' ? { userId: data.uid } : {}) };
  } catch {
    return null;
  }
}

/** Resolves the session from the cookie; accounts that were deactivated lose access immediately. */
async function resolveSession(config: Config, db: Db, token: string | undefined): Promise<Session | null> {
  const identity = verifySessionToken(config, token);
  if (!identity) return null;
  if (identity.role === 'client') {
    // A client archived after the link was issued loses access at once.
    const [client] = await db.select({ id: clients.id, name: clients.name, archivedAt: clients.archivedAt }).from(clients).where(eq(clients.id, identity.clientId!));
    if (!client || client.archivedAt) return null;
    return { role: 'client', clientId: client.id, name: client.name };
  }
  if (identity.userId === undefined) return { role: identity.role, name: OWNER_NAME };
  const [user] = await db.select().from(users).where(eq(users.id, identity.userId));
  if (!user || !user.active) return null;
  return { role: user.role, userId: user.id, name: user.name };
}

/**
 * Guard for the staff API (everything under `/api` except auth, public and portal). Deny by default: only `admin` and
 * `employee` pass, so any role added later (like `client`) is rejected by every existing route until it is allowed on purpose.
 */
export const requireSession =
  (config: Config, db: Db): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const session = await resolveSession(config, db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    if (session.role !== 'admin' && session.role !== 'employee') {
      return c.json(errorBody('forbidden', 'No tenés permiso para esta acción'), 403);
    }
    c.set('session', session);
    await next();
  };

/** Guard for `/api/portal/*` data routes: only a client session, always read through `session.clientId`. */
export const requireClientSession =
  (config: Config, db: Db): MiddlewareHandler<AuthEnv> =>
  async (c, next) => {
    const session = await resolveSession(config, db, getCookie(c, SESSION_COOKIE));
    if (!session) return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    if (session.role !== 'client' || session.clientId === undefined) {
      return c.json(errorBody('forbidden', 'No tenés permiso para esta acción'), 403);
    }
    c.set('session', session);
    await next();
  };

export function setSessionCookie(c: Context, config: Config, token: string, maxAge: number) {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: config.isProduction, path: '/', maxAge });
}

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

const loginBody = z.object({
  username: z.string().trim().max(100).optional(),
  password: z.string().max(500),
});

export function authRoutes(config: Config, db: Db) {
  const failures = new Map<string, { count: number; first: number }>();
  const app = new Hono<AuthEnv>();

  app.post('/login', v('json', loginBody), async (c) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
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
      ...(session.clientId === undefined ? {} : { clientId: session.clientId }),
      name: session.name,
    });
  });

  return app;
}
