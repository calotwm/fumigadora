import { Hono } from 'hono';
import { monthOf } from '@fumigadora/shared';
import { z } from 'zod';
import { idParam, v, zMonth, type Deps } from '../http.js';
import { createEmployeePay, deleteEmployeePay, employeePayInput, employeePayMonth } from '../services/employeePay.js';

export function employeePayRoutes({ db, today }: Deps) {
  return new Hono()
    .get('/', v('query', z.object({ month: zMonth.optional() })), async (c) =>
      c.json(await employeePayMonth(db, c.req.valid('query').month ?? monthOf(today()))),
    )
    .post('/', v('json', employeePayInput), async (c) => c.json(await createEmployeePay(db, today(), c.req.valid('json')), 201))
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteEmployeePay(db, c.req.valid('param').id)));
}
