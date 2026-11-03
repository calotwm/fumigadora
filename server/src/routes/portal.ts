import { Hono } from 'hono';
import { z } from 'zod';
import { createSessionToken, PORTAL_SESSION_TTL_SECONDS, requireClientSession, setSessionCookie, type AuthEnv } from '../auth.js';
import { AppError, errorBody, idParam, notFound, v, type Deps } from '../http.js';
import {
  checkLoginToken,
  consumeLoginToken,
  ownCertificateFile,
  portalCertificates,
  portalInvoices,
  portalPayments,
  portalSummary,
  portalVisits,
  sendLoginLink,
} from '../services/portal.js';
import { readStoredFile } from '../services/files.js';
import { requestOrigin } from '../services/publicLink.js';
import { createRateLimiter } from '../services/rateLimit.js';

const LIMIT_WINDOW_MS = 15 * 60_000;
const GENERIC_SENT = 'Si el email corresponde a un cliente, te enviamos un enlace para ingresar. Revisá tu bandeja de entrada (y el correo no deseado).';
const INVALID_LINK = new AppError(400, 'invalid_link', 'El enlace no es válido o ya venció. Pedí uno nuevo.');

const loginBody = z.object({ email: z.string().trim().toLowerCase().email('Ingresá un email válido').max(200) });
const verifyBody = z.object({ token: z.string().trim().min(1).max(200) });
const selectBody = verifyBody.extend({ clientId: z.number().int().positive() });

/**
 * Client portal. Login (magic link) is public; every data route sits behind `requireClientSession` and reads only
 * through the `clientId` of the session, never an id from the request.
 */
export function portalRoutes(deps: Deps) {
  const { db, config, today } = deps;
  const nowDate = () => (deps.now ?? (() => new Date()))();
  const limits = deps.portalLimits ?? { perEmail: 3, perIp: 10 };
  const perEmail = createRateLimiter(limits.perEmail, LIMIT_WINDOW_MS);
  const perIp = createRateLimiter(limits.perIp, LIMIT_WINDOW_MS);

  const open = (c: Parameters<typeof setSessionCookie>[0], clientId: number) =>
    setSessionCookie(c, config, createSessionToken(config, { role: 'client', clientId }), PORTAL_SESSION_TTL_SECONDS);

  return (
    new Hono<AuthEnv>()
      // Always the same answer: whether the email belongs to a client must not be observable, neither in the body nor in the
      // time it takes, so the lookup and the mail run after the response.
      .post('/login', v('json', loginBody), async (c) => {
        const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
        const { email } = c.req.valid('json');
        const ipOk = perIp.hit(ip);
        const emailOk = perEmail.hit(email);
        if (!ipOk || !emailOk) {
          return c.json(errorBody('rate_limited', 'Demasiados pedidos. Probá de nuevo en unos minutos.'), 429);
        }
        // Behind a spoofable Host header the link could point elsewhere, so production needs PUBLIC_BASE_URL.
        const base = config.publicBaseUrl ?? (config.isProduction ? null : requestOrigin(c));
        void sendLoginLink({ ...deps, today, now: nowDate }, email, base).catch((e) => console.error('[portal] could not send the login link', e));
        return c.json({ ok: true, message: GENERIC_SENT });
      })
      // Opening the link: one client logs straight in; several get a picker (the token is spent when one is chosen).
      // POST, not GET: mail scanners that prefetch links must not burn the token.
      .post('/verify', v('json', verifyBody), async (c) => {
        const check = await checkLoginToken(db, c.req.valid('json').token, nowDate());
        if (!check.ok) throw INVALID_LINK;
        if (check.clients.length > 1) return c.json({ status: 'choose', clients: check.clients });
        const only = check.clients[0]!;
        if (!(await consumeLoginToken(db, check.tokenId, nowDate()))) throw INVALID_LINK;
        open(c, only.id);
        return c.json({ status: 'ok', client: only });
      })
      .post('/select', v('json', selectBody), async (c) => {
        const { token, clientId } = c.req.valid('json');
        const check = await checkLoginToken(db, token, nowDate());
        // Only a client that matched this very token can be chosen.
        const chosen = check.ok ? check.clients.find((cl) => cl.id === clientId) : undefined;
        if (!check.ok || !chosen) throw INVALID_LINK;
        if (!(await consumeLoginToken(db, check.tokenId, nowDate()))) throw INVALID_LINK;
        open(c, chosen.id);
        return c.json({ status: 'ok', client: chosen });
      })
      .use('*', requireClientSession(config, db))
      .use('*', async (c, next) => {
        await next();
        c.header('cache-control', 'private, no-store');
      })
      .get('/me', (c) => {
        const { clientId, name } = c.get('session');
        return c.json({ client: { id: clientId, name } });
      })
      .get('/summary', async (c) => c.json(await portalSummary(db, today(), c.get('session').clientId!)))
      .get('/visits', async (c) => c.json(await portalVisits(db, c.get('session').clientId!)))
      .get('/invoices', async (c) => c.json(await portalInvoices(db, today(), c.get('session').clientId!)))
      .get('/payments', async (c) => c.json(await portalPayments(db, c.get('session').clientId!)))
      .get('/certificates', async (c) => c.json(await portalCertificates(db, today(), c.get('session').clientId!)))
      .get('/certificates/:id/file', v('param', idParam), async (c) => {
        const cert = await ownCertificateFile(db, c.get('session').clientId!, c.req.valid('param').id);
        const bytes = cert?.fileKey ? await readStoredFile(config.filesDir, cert.fileKey) : null;
        if (!cert || !bytes) throw notFound('Archivo de la oblea');
        const name = `oblea-${cert.number}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
        return c.body(new Uint8Array(bytes), 200, {
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="${name}"`,
          'cache-control': 'private, no-store',
        });
      })
  );
}
