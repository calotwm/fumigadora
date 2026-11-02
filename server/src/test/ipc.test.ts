import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../http.js';
import { ARGLY_IPC_URL, listIpcRates, parseArglyIpc } from '../services/ipc.js';
import { maybeSyncIpc } from '../services/jobs.js';
import { makeTestApp, type TestApp } from './helpers.js';

const ARGLY_BODY = {
  data: [
    { mes: 3, anio: 2025, nombre_mes: 'marzo', valor: 3.7 },
    { mes: 4, anio: 2025, nombre_mes: 'abril', valor: 2.8 },
    { mes: 5, anio: 2025, nombre_mes: 'mayo', valor: 1.5 },
  ],
};

function fakeFetch(answer: () => Response) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return answer();
  }) as typeof fetch;
  return { fn, calls };
}

describe('IPC debt update', () => {
  let t: TestApp;
  let deps: Deps;
  let clientId: number;
  let answer: () => Response = () => Response.json(ARGLY_BODY);
  const fetcher = fakeFetch(() => answer());

  beforeAll(async () => {
    t = await makeTestApp('2025-06-15', undefined, { fetch: fetcher.fn });
    deps = { db: t.db, config: t.config, mail: t.mail, today: t.today, fetch: fetcher.fn };
    clientId = (await t.post('/api/clients', { name: 'Kiosco Marzo' })).body.id;
    await t.post('/api/invoices', { clientId, amountCents: 100_000_00, issuedOn: '2025-03-01', dueOn: '2025-03-20', periodMonth: '2025-03' });
    await t.post('/api/invoices', { clientId, amountCents: 50_000_00, issuedOn: '2025-06-01', dueOn: '2025-06-30', periodMonth: '2025-06' });
  });
  afterAll(() => t.close());

  it('shows no update before the IPC is synced', async () => {
    const res = await t.get(`/api/clients/${clientId}/months`);
    expect(res.status).toBe(200);
    expect(res.body.ipc).toEqual({ throughMonth: null, totalCents: 0, updatedOwedCents: 150_000_00 });
  });

  it('syncs the Argly history once per day and updates overdue debt to the last published month', async () => {
    expect(await maybeSyncIpc(deps)).toEqual({ months: 3, latest: '2025-05' });
    expect(fetcher.calls).toEqual([ARGLY_IPC_URL]);
    expect(await maybeSyncIpc(deps)).toBeNull();
    expect(fetcher.calls).toHaveLength(1);

    const res = await t.get(`/api/clients/${clientId}/months`);
    // March debt: April 2.8 % and May 1.5 % compounded = 4.342 %. June is not due yet.
    expect(res.body.months.map((m: { month: string; ipcCents: number }) => [m.month, m.ipcCents])).toEqual([
      ['2025-03', 4_342_00],
      ['2025-06', 0],
    ]);
    expect(res.body.ipc).toEqual({ throughMonth: '2025-05', totalCents: 4_342_00, updatedOwedCents: 154_342_00 });
    // The debt itself is not changed.
    expect(res.body.totalOwedCents).toBe(150_000_00);
    expect((await t.get(`/api/clients/${clientId}`)).body.summary.balanceCents).toBe(150_000_00);
  });

  it('keeps the stored months and retries on the next tick when Argly fails', async () => {
    t.setToday('2025-06-16');
    answer = () => new Response('down', { status: 503 });
    await expect(maybeSyncIpc(deps)).rejects.toThrow('503');
    expect(await listIpcRates(t.db)).toHaveLength(3);

    answer = () => Response.json({ data: [...ARGLY_BODY.data, { mes: 6, anio: 2025, valor: 1.6 }] });
    expect(await maybeSyncIpc(deps)).toEqual({ months: 4, latest: '2025-06' });
  });
});

describe('parseArglyIpc', () => {
  it('turns each month into basis points and skips malformed rows', () => {
    expect(
      parseArglyIpc({
        data: [
          { mes: 9, anio: 2026, valor: 1.9 },
          { mes: 13, anio: 2026, valor: 1 },
          { mes: 8, anio: 2026, valor: null },
          { mes: 7, anio: 2026, valor: 'x' },
        ],
      }),
    ).toEqual([{ month: '2026-09', percentBp: 190 }]);
    expect(parseArglyIpc(null)).toEqual([]);
  });
});
