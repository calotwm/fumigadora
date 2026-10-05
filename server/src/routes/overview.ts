import { Hono } from 'hono';
import { z } from 'zod';
import { v, type Deps } from '../http.js';
import { certificateListQuery, listCertificates } from '../services/certificates.js';
import { dashboard } from '../services/dashboard.js';
import { searchClients } from '../services/search.js';

export function certificateRoutes({ db, today }: Deps) {
  return new Hono().get('/', v('query', certificateListQuery), async (c) =>
    c.json(await listCertificates(db, today(), c.req.valid('query'))),
  );
}

export function dashboardRoutes({ db, today }: Deps) {
  return new Hono().get('/', async (c) => c.json(await dashboard(db, today())));
}

export function searchRoutes({ db }: Deps) {
  return new Hono().get('/', v('query', z.object({ q: z.string().trim().min(1).max(100) })), async (c) =>
    c.json({ clients: await searchClients(db, c.req.valid('query').q) }),
  );
}
