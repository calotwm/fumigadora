import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './helpers.js';

interface Row {
  clientId: number;
  name: string;
  zone: string | null;
  expected: number;
  done: number;
  scheduled: number;
  pendingUnscheduled: number;
  status: string;
  lastDoneOn: string | null;
  daysSinceLast: number | null;
  nextScheduled: { id: number; date: string; time: string | null } | null;
}

describe('monthly tracking', () => {
  let t: TestApp;
  const ids: Record<string, number> = {};
  let serviceA = 0;
  let serviceB = 0;

  async function client(key: string, body: Record<string, unknown>) {
    const res = await t.post('/api/clients', body);
    expect(res.status).toBe(201);
    ids[key] = res.body.id;
  }
  async function visit(key: string, date: string, serviceTypeId = serviceA, done = false) {
    const res = await t.post('/api/visits', { clientId: ids[key], serviceTypeId, date, frequency: 'monthly' });
    expect(res.status).toBe(201);
    if (done) {
      const c = await t.post(`/api/visits/${res.body.id}/complete`, { completedOn: date });
      expect(c.status).toBe(200);
    }
  }

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15');
    serviceA = (await t.post('/api/service-types', { name: 'Desinsectación' })).body.id;
    serviceB = (await t.post('/api/service-types', { name: 'Desratización' })).body.id;
    const plan = { serviceFrequency: 'monthly', defaultServiceTypeId: serviceA };

    await client('done', { name: 'Consorcio Done', area: 'Sur', ...plan });
    await visit('done', '2025-06-03', serviceA, true);

    await client('sched', { name: 'Consorcio Sched', area: 'Sur', ...plan });
    await visit('sched', '2025-05-10', serviceA, true);
    await visit('sched', '2025-06-25');

    await client('pending', { name: 'Consorcio Pending', area: 'Sur', ...plan });
    await visit('pending', '2025-05-20', serviceA, true);

    await client('weekly', { name: 'Restaurante Weekly', area: 'Norte', serviceFrequency: 'weekly', defaultServiceTypeId: serviceA });
    await visit('weekly', '2025-06-02', serviceA, true);
    await visit('weekly', '2025-06-09', serviceA, true);
    await visit('weekly', '2025-06-16');

    await client('bimonthly', { name: 'Casa Bimonthly', area: 'Norte', serviceFrequency: 'bimonthly', defaultServiceTypeId: serviceA });
    await visit('bimonthly', '2025-05-01', serviceA, true); // next due 2025-07-01

    await client('noplan', { name: 'Sin plan', area: 'Sur' });
    await visit('noplan', '2025-06-04', serviceA, true);

    // Another service done in June does not satisfy a plan tied to a different service.
    await client('other', { name: 'Consorcio Otro Servicio', area: 'Sur', ...plan });
    await visit('other', '2025-06-05', serviceB, true);
  });
  afterAll(() => t.close());

  const byName = (rows: Row[], name: string) => rows.find((r) => r.name === name)!;

  it('counts done, scheduled and pending-unscheduled per client and in total', async () => {
    const res = await t.get('/api/tracking?month=2025-06');
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2025-06');
    expect(res.body.zones).toEqual(['Norte', 'Sur']);
    expect(res.body.totals).toEqual({ expected: 9, done: 3, scheduled: 2, pendingUnscheduled: 4, clientsTracked: 6 });

    const rows: Row[] = res.body.rows;
    expect(rows.map((r) => r.name)).not.toContain('Sin plan');
    expect(rows.map((r) => r.name)).not.toContain('Casa Bimonthly'); // not due until July

    expect(byName(rows, 'Consorcio Done')).toMatchObject({ expected: 1, done: 1, status: 'complete', lastDoneOn: '2025-06-03', daysSinceLast: 12 });
    expect(byName(rows, 'Consorcio Sched')).toMatchObject({
      expected: 1,
      done: 0,
      scheduled: 1,
      pendingUnscheduled: 0,
      status: 'scheduled',
      lastDoneOn: '2025-05-10',
      nextScheduled: { date: '2025-06-25', time: null },
    });
    expect(byName(rows, 'Consorcio Pending')).toMatchObject({ pendingUnscheduled: 1, status: 'pending', daysSinceLast: 26, nextScheduled: null });
    expect(byName(rows, 'Restaurante Weekly')).toMatchObject({ expected: 5, done: 2, scheduled: 1, pendingUnscheduled: 2, status: 'pending' });
    expect(byName(rows, 'Consorcio Otro Servicio')).toMatchObject({ done: 0, pendingUnscheduled: 1, status: 'pending' });
  });

  it('filters by zone and status', async () => {
    const north = await t.get('/api/tracking?month=2025-06&zone=Norte');
    expect(north.body.rows.map((r: Row) => r.name)).toEqual(['Restaurante Weekly']);
    expect(north.body.totals.expected).toBe(5);
    expect(north.body.zones).toEqual(['Norte', 'Sur']);

    const pending = await t.get('/api/tracking?month=2025-06&status=pending');
    expect(pending.body.rows.map((r: Row) => r.name).sort()).toEqual(
      ['Consorcio Otro Servicio', 'Consorcio Pending', 'Restaurante Weekly'].sort(),
    );
    // Totals are not narrowed by the status filter.
    expect(pending.body.totals.expected).toBe(9);

    const complete = await t.get('/api/tracking?month=2025-06&status=complete');
    expect(complete.body.rows.map((r: Row) => r.name)).toEqual(['Consorcio Done']);
  });

  it('defaults to the current month and rejects a malformed one', async () => {
    expect((await t.get('/api/tracking')).body.month).toBe('2025-06');
    expect((await t.get('/api/tracking?month=2025-6')).status).toBe(400);
  });

  it('schedules several clients atomically with the plan frequency', async () => {
    const res = await t.post('/api/tracking/schedule', {
      month: '2025-06',
      items: [
        { clientId: ids.pending, date: '2025-06-27', time: '09:30' },
        { clientId: ids.other, date: '2025-06-27', serviceTypeId: serviceB },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.created[0]).toMatchObject({
      clientId: ids.pending,
      serviceTypeId: serviceA,
      date: '2025-06-27',
      time: '09:30',
      status: 'scheduled',
      frequency: 'monthly',
    });

    const board = await t.get('/api/tracking?month=2025-06');
    const rows: Row[] = board.body.rows;
    expect(byName(rows, 'Consorcio Pending')).toMatchObject({ status: 'scheduled', scheduled: 1, pendingUnscheduled: 0 });
    // "Otro Servicio" is planned for service A but was scheduled with B: still pending for its plan.
    expect(byName(rows, 'Consorcio Otro Servicio').status).toBe('pending');
    expect(board.body.totals).toMatchObject({ expected: 9, done: 3, scheduled: 3, pendingUnscheduled: 3 });
  });

  it('rejects the whole batch when one item is invalid', async () => {
    const before = (await t.get('/api/visits')).body.length;
    const outside = await t.post('/api/tracking/schedule', {
      month: '2025-06',
      items: [
        { clientId: ids.done, date: '2025-06-28' },
        { clientId: ids.sched, date: '2025-07-02' },
      ],
    });
    expect(outside.status).toBe(400);
    const noService = await t.post('/api/tracking/schedule', {
      month: '2025-06',
      items: [
        { clientId: ids.done, date: '2025-06-28' },
        { clientId: ids.noplan, date: '2025-06-28' },
      ],
    });
    expect(noService.status).toBe(400);
    const missing = await t.post('/api/tracking/schedule', { month: '2025-06', items: [{ clientId: 99999, date: '2025-06-28' }] });
    expect(missing.status).toBe(404);
    expect((await t.get('/api/visits')).body).toHaveLength(before);
  });

  it('exposes the plan on clients and validates the service type', async () => {
    const created = await t.get(`/api/clients/${ids.weekly}`);
    expect(created.body).toMatchObject({ serviceFrequency: 'weekly', defaultServiceTypeId: serviceA });
    const patched = await t.patch(`/api/clients/${ids.noplan}`, { serviceFrequency: 'quarterly', defaultServiceTypeId: serviceB });
    expect(patched.body).toMatchObject({ serviceFrequency: 'quarterly', defaultServiceTypeId: serviceB });
    expect((await t.patch(`/api/clients/${ids.noplan}`, { defaultServiceTypeId: 99999 })).status).toBe(404);
    const cleared = await t.patch(`/api/clients/${ids.noplan}`, { serviceFrequency: 'none', defaultServiceTypeId: null });
    expect(cleared.body).toMatchObject({ serviceFrequency: 'none', defaultServiceTypeId: null });
    expect((await t.patch(`/api/clients/${ids.noplan}`, { serviceFrequency: 'daily' })).status).toBe(400);
    // A service type used as a plan cannot be deleted.
    expect((await t.del(`/api/service-types/${serviceA}`)).status).toBe(409);
  });

  it('summarises the month on the dashboard', async () => {
    const dash = await t.get('/api/dashboard');
    expect(dash.body.tracking).toMatchObject({ month: '2025-06', expected: 9, done: 3, clientsTracked: 6 });
    expect(dash.body.tracking.scheduled + dash.body.tracking.pendingUnscheduled + dash.body.tracking.done).toBe(9);
  });
});
