import { Hono } from 'hono';
import { z } from 'zod';
import { idParam, notFound, v, type Deps } from '../http.js';
import { certificateFileInfo, certificateListQuery, listCertificates } from '../services/certificates.js';
import { readStoredFile } from '../services/files.js';
import { dashboard } from '../services/dashboard.js';
import { searchClients } from '../services/search.js';

export function certificateRoutes({ db, config, today }: Deps) {
  return new Hono()
    .get('/', v('query', certificateListQuery), async (c) => c.json(await listCertificates(db, today(), c.req.valid('query'))))
    .get('/:id/file', v('param', idParam), async (c) => {
      const cert = await certificateFileInfo(db, c.req.valid('param').id);
      const bytes = cert?.fileKey ? await readStoredFile(config.filesDir, cert.fileKey) : null;
      if (!cert || !bytes) throw notFound('Archivo de la oblea');
      const name = `oblea-${cert.number}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
      return c.body(new Uint8Array(bytes), 200, {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${name}"`,
        'cache-control': 'private, no-store',
      });
    });
}

export function dashboardRoutes({ db, today }: Deps) {
  return new Hono().get('/', async (c) => c.json(await dashboard(db, today())));
}

export function searchRoutes({ db }: Deps) {
  return new Hono().get('/', v('query', z.object({ q: z.string().trim().min(1).max(100) })), async (c) =>
    c.json({ clients: await searchClients(db, c.req.valid('query').q) }),
  );
}
