import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z, type ZodType } from 'zod';
import { isIsoDate, isIsoMonth, type IsoDate } from '@fumigadora/shared';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { MailProvider } from './mail/provider.js';

/** Dependencies shared by every route/service. `today()` is injectable for deterministic tests. */
export interface Deps {
  db: Db;
  config: Config;
  mail: MailProvider;
  today: () => IsoDate;
  /** HTTP client used for ARCA (tests inject a mock). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Wall clock (tests inject one). Used to group bursts of admin alerts. Defaults to `new Date()`. */
  now?: () => Date;
  /** Window in which repeated alerts from the same employee are grouped. Defaults to 10 minutes. */
  alertWindowMs?: number;
  /** Magic-link requests allowed per email and per IP in 15 minutes. Defaults to 3 and 10. */
  portalLimits?: { perEmail: number; perIp: number };
}

/** Business error rendered as `{ error: { code, message } }`. Messages are user-facing Spanish. */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} no encontrado`);
export const badRequest = (message: string, code = 'bad_request') => new AppError(400, code, message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/** Zod validator that answers with the standard error body. */
export function v<T extends ZodType, Target extends 'json' | 'query' | 'param'>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return c.json(errorBody('validation', 'Datos inválidos', { issues }), 400);
    }
    return undefined;
  });
}

export function respond<T>(c: Context, body: T, status: ContentfulStatusCode = 200) {
  return c.json(body, status);
}

// ---------- shared zod building blocks ----------

export const zDate = z.string().refine(isIsoDate, 'Fecha inválida (usar AAAA-MM-DD)');
export const zMonth = z.string().refine(isIsoMonth, 'Mes inválido (usar AAAA-MM)');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Hora inválida (usar HH:MM)');
export const zId = z.coerce.number().int().positive();
export const zCents = z.number().int().min(0, 'El monto no puede ser negativo').max(1e13);
export const zPositiveCents = z.number().int().positive('El monto debe ser mayor a cero').max(1e13);
/** Trimmed text where empty string becomes null; `undefined` stays undefined (partial updates). */
export const zOptText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullish();
export const zBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((b) => b === true || b === 'true');

export const idParam = z.object({ id: zId });

/** Drops `undefined` keys so partial updates never overwrite with undefined. */
export function definedOnly<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined)) as Partial<T>;
}

/** Postgres `time` -> `HH:MM`. */
export function hhmm(time: string | null | undefined): string | null {
  return time ? time.slice(0, 5) : null;
}

/** Escapes `%` and `_` for ILIKE patterns. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
