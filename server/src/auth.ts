import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Config } from './config.js';
import { errorBody, v } from './http.js';

export const SESSION_COOKIE = 'fumigadora_session';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time string comparison (hashes first so length differences do not leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSessionToken(config: Config, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + config.sessionTtlSeconds })).toString('base64url');
  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

export function verifySessionToken(config: Config, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, config.sessionSecret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
    return typeof exp === 'number' && exp * 1000 > now;
  } catch {
    return false;
  }
}

export const requireSession =
  (config: Config): MiddlewareHandler =>
  async (c, next) => {
    if (!verifySessionToken(config, getCookie(c, SESSION_COOKIE))) {
      return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    }
    await next();
  };

/** Naive in-memory throttle: max 8 failed logins per IP per 10 minutes. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

export function authRoutes(config: Config) {
  const failures = new Map<string, { count: number; first: number }>();
  const app = new Hono();

  app.post('/login', v('json', z.object({ password: z.string().max(500) })), async (c) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_FAILURES) {
      return c.json(errorBody('rate_limited', 'Demasiados intentos. Probá de nuevo en unos minutos.'), 429);
    }
    const { password } = c.req.valid('json');
    if (!safeEqual(password, config.adminPassword)) {
      const fresh = entry && now - entry.first < WINDOW_MS ? entry : { count: 0, first: now };
      fresh.count += 1;
      failures.set(key, fresh);
      return c.json(errorBody('invalid_credentials', 'Contraseña incorrecta'), 401);
    }
    failures.delete(key);
    setCookie(c, SESSION_COOKIE, createSessionToken(config), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.isProduction,
      path: '/',
      maxAge: config.sessionTtlSeconds,
    });
    return c.json({ authenticated: true });
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ authenticated: false });
  });

  app.get('/me', (c) => {
    if (!verifySessionToken(config, getCookie(c, SESSION_COOKIE))) {
      return c.json(errorBody('unauthorized', 'Necesitás iniciar sesión'), 401);
    }
    return c.json({ authenticated: true });
  });

  return app;
}
