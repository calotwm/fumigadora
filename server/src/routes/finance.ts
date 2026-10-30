import { Hono } from 'hono';
import { monthOf } from '@fumigadora/shared';
import { z } from 'zod';
import { idParam, notFound, v, zMonth, type Deps } from '../http.js';
import { readStoredFile } from '../services/files.js';
import { fileResponse } from '../services/uploads.js';
import {
  cashInput,
  cashListQuery,
  cashReceiptInfo,
  cashPatch,
  createCashEntry,
  deleteCashEntry,
  listCashEntries,
  updateCashEntry,
} from '../services/cash.js';
import { financeMovements, financeSummary } from '../services/finance.js';

const monthQuery = z.object({ month: zMonth.optional() });

export function cashRoutes({ db, config, today }: Deps) {
  return new Hono()
    .get('/', v('query', cashListQuery), async (c) => c.json(await listCashEntries(db, today(), c.req.valid('query'))))
    .post('/', v('json', cashInput), async (c) => c.json(await createCashEntry(db, today(), c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', cashPatch), async (c) =>
      c.json(await updateCashEntry(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteCashEntry(db, c.req.valid('param').id, config.filesDir)))
    // Photo of the receipt (fuel loads), owner only like every route here.
    .get('/:id/receipt', v('param', idParam), async (c) => {
      const id = c.req.valid('param').id;
      const info = await cashReceiptInfo(db, id);
      const bytes = info ? await readStoredFile(config.filesDir, info.key) : null;
      if (!info || !bytes) throw notFound('Comprobante');
      return fileResponse(c, bytes, info.type, `ticket-${info.date}-${id}.${info.key.split('.').pop()}`);
    });
}

export function financeRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/summary', v('query', monthQuery), async (c) =>
      c.json(await financeSummary(db, c.req.valid('query').month ?? monthOf(today()))),
    )
    .get('/movements', v('query', monthQuery), async (c) =>
      c.json(await financeMovements(db, c.req.valid('query').month ?? monthOf(today()))),
    );
}
