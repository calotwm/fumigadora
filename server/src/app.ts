import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { today as businessToday } from '@fumigadora/shared';
import { authRoutes, requireAdmin, requireSession, type AuthEnv } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { AppError, errorBody, type Deps } from './http.js';
import { expenseCategoryRoutes, serviceTypeRoutes } from './routes/catalog.js';
import { handoverRoutes } from './routes/handover.js';
import { meRoutes } from './routes/me.js';
import { userRoutes } from './routes/users.js';
import { clientRoutes } from './routes/clients.js';
import { cashRoutes, financeRoutes } from './routes/finance.js';
import { invoiceRoutes, paymentRoutes, receivablesRoutes } from './routes/billing.js';
import { certificateRoutes, dashboardRoutes, searchRoutes } from './routes/overview.js';
import { trackingRoutes } from './routes/tracking.js';
import { agendaRoutes, visitRoutes } from './routes/visits.js';
import { mountStatic } from './static.js';

export interface AppOptions {
  db: Db;
  config: Config;
  /** Override the business date (tests). Defaults to today in America/Argentina/Buenos_Aires. */
  today?: () => string;
  /** Serve the built SPA. Defaults to true; pass false in tests. */
  serveWeb?: boolean;
}

export function createApp(options: AppOptions) {
  const deps: Deps = {
    db: options.db,
    config: options.config,
    today: options.today ?? (() => businessToday()),
  };

  const api = new Hono<AuthEnv>();
  api.get('/health', (c) => c.json({ ok: true }));
  api.route('/auth', authRoutes(deps.config, deps.db));
  api.use('*', requireSession(deps.config, deps.db));
  // Employee routes sit before the admin guard; everything below is owner-only.
  api.route('/me', meRoutes(deps));
  api.use('*', requireAdmin);
  api.route('/users', userRoutes(deps));
  api.route('/cash-handover', handoverRoutes(deps));
  api.route('/clients', clientRoutes(deps));
  api.route('/service-types', serviceTypeRoutes(deps));
  api.route('/expense-categories', expenseCategoryRoutes(deps));
  api.route('/visits', visitRoutes(deps));
  api.route('/agenda', agendaRoutes(deps));
  api.route('/tracking', trackingRoutes(deps));
  api.route('/invoices', invoiceRoutes(deps));
  api.route('/payments', paymentRoutes(deps));
  api.route('/cash-entries', cashRoutes(deps));
  api.route('/finance', financeRoutes(deps));
  api.route('/receivables', receivablesRoutes(deps));
  api.route('/certificates', certificateRoutes(deps));
  api.route('/dashboard', dashboardRoutes(deps));
  api.route('/search', searchRoutes(deps));
  api.notFound((c) => c.json(errorBody('not_found', 'Recurso no encontrado'), 404));

  const app = new Hono();
  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message, err.details), err.status);
    if (err instanceof HTTPException) return c.json(errorBody('http_error', err.message), err.status);
    if (err instanceof RangeError) return c.json(errorBody('bad_request', err.message), 400);
    // Unique violation (e.g. a repeated certificate number); drizzle wraps the driver error in `cause`.
    const pgCode = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (pgCode === '23505') {
      return c.json(errorBody('duplicate', 'Ya existe un registro con ese valor (por ejemplo, un número repetido)'), 409);
    }
    console.error('[error]', err);
    return c.json(errorBody('internal', 'Error interno del servidor'), 500);
  });

  if (options.serveWeb ?? true) mountStatic(app);
  return app;
}

export type App = ReturnType<typeof createApp>;
