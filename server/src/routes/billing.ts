import { Hono } from 'hono';
import { z } from 'zod';
import { idParam, v, zMonth, type Deps } from '../http.js';
import {
  createInvoice,
  getInvoice,
  invoiceInput,
  invoiceListQuery,
  listInvoices,
  monthlyBatchCreate,
  monthlyBatchInput,
  monthlyBatchPreview,
  voidInvoice,
} from '../services/invoices.js';
import { createPayment, deletePayment, listPayments, paymentInput, paymentListQuery } from '../services/payments.js';
import { receivables } from '../services/receivables.js';

export function invoiceRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', invoiceListQuery), async (c) => c.json(await listInvoices(db, today(), c.req.valid('query'))))
    .post('/', v('json', invoiceInput), async (c) => c.json(await createInvoice(db, today(), c.req.valid('json')), 201))
    .post('/monthly-batch/preview', v('query', z.object({ month: zMonth })), async (c) =>
      c.json(await monthlyBatchPreview(db, c.req.valid('query').month)),
    )
    .post('/monthly-batch', v('json', monthlyBatchInput), async (c) =>
      c.json(await monthlyBatchCreate(db, today(), c.req.valid('json')), 201),
    )
    .get('/:id', v('param', idParam), async (c) => c.json(await getInvoice(db, today(), c.req.valid('param').id)))
    .post('/:id/void', v('param', idParam), async (c) => c.json(await voidInvoice(db, today(), c.req.valid('param').id)));
}

export function paymentRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', paymentListQuery), async (c) => c.json(await listPayments(db, c.req.valid('query'))))
    .post('/', v('json', paymentInput), async (c) => c.json(await createPayment(db, today(), c.req.valid('json')), 201))
    .delete('/:id', v('param', idParam), async (c) => c.json(await deletePayment(db, today(), c.req.valid('param').id)));
}

export function receivablesRoutes({ db, today }: Deps) {
  return new Hono().get('/', async (c) => c.json(await receivables(db, today())));
}
