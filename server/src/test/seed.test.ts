import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { today as realToday } from '@fumigadora/shared';
import { runSeed } from '../seed-data.js';
import { makeTestApp, type TestApp } from './helpers.js';

describe('seed', () => {
  let t: TestApp;
  const today = realToday();
  beforeAll(async () => {
    t = await makeTestApp(today);
    await runSeed(t.db, today);
  });
  afterAll(() => t.close());

  it('produces realistic, internally consistent data and is re-runnable', async () => {
    const summary = await runSeed(t.db, today);
    expect(summary.clients).toBe(35);
    expect(summary.invoices).toBeGreaterThan(100);

    const clients = await t.get('/api/clients?sort=overdue');
    expect(clients.body).toHaveLength(35);
    const aging = new Set(clients.body.map((c: { agingBucket: string }) => c.agingBucket));
    expect(aging.has('current')).toBe(true);
    expect([...aging].some((b) => b === '90+' || b === '61-90' || b === '31-60')).toBe(true);
    expect(clients.body.filter((c: { monthlyFeeCents: number | null }) => c.monthlyFeeCents).length).toBeGreaterThan(10);

    const dash = await t.get('/api/dashboard');
    expect(dash.body.agenda.today).toBeGreaterThanOrEqual(4);
    expect(dash.body.agenda.tomorrow).toBeGreaterThanOrEqual(3);
    expect(dash.body.agenda.overdueScheduled).toBeGreaterThanOrEqual(2);
    expect(dash.body.topDebtors.length).toBeGreaterThan(0);
    expect(dash.body.receivables.owedCents).toBeGreaterThan(0);
    expect(dash.body.expiringCertificates.length).toBeGreaterThan(0);

    // Allocations never exceed invoice amounts or payment amounts.
    const invoices = await t.get('/api/invoices');
    for (const inv of invoices.body) {
      expect(inv.paidCents).toBeLessThanOrEqual(inv.amountCents);
      expect(inv.balanceCents).toBe(inv.amountCents - inv.paidCents);
    }
    const payments = await t.get('/api/payments');
    for (const p of payments.body) expect(p.unallocatedCents).toBeGreaterThanOrEqual(0);

    const rec = await t.get('/api/receivables');
    expect(rec.body.buckets).toHaveLength(5);
    expect(rec.body.buckets.find((b: { bucket: string }) => b.bucket === '90+').totalCents).toBeGreaterThan(0);
  });
});
