import { and, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import { addDays, addMonthsToMonth, monthOf, monthRange, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, visits } from '../db/schema.js';
import { listCertificates } from './certificates.js';
import { monthFigures } from './finance.js';
import { receivables } from './receivables.js';
import { trackingSummary } from './tracking.js';
import { agendaSummary, listVisits } from './visits.js';

async function doneVisitsInMonth(db: Db, month: string) {
  const { from, to } = monthRange(month);
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(visits)
    .where(and(eq(visits.status, 'done'), gte(visits.date, from), lte(visits.date, to)));
  return row?.n ?? 0;
}

/** Active clients with a visit in the last 120 days and nothing scheduled from today on. */
async function clientsWithoutNextVisit(db: Db, today: IsoDate) {
  const since = addDays(today, -120);
  const [recent, upcoming] = await Promise.all([
    db
      .selectDistinct({ id: visits.clientId })
      .from(visits)
      .innerJoin(clients, eq(clients.id, visits.clientId))
      .where(and(isNull(clients.archivedAt), ne(visits.status, 'cancelled'), gte(visits.date, since), lte(visits.date, today))),
    db
      .selectDistinct({ id: visits.clientId })
      .from(visits)
      .where(and(eq(visits.status, 'scheduled'), gte(visits.date, today))),
  ]);
  const upcomingIds = new Set(upcoming.map((u) => u.id));
  return recent.filter((r) => !upcomingIds.has(r.id)).length;
}

/** Everything the "Hoy" screen needs, in one call. */
export async function dashboard(db: Db, today: IsoDate) {
  const month = monthOf(today);
  const previousMonth = addMonthsToMonth(month, -1);
  const [figures, recv, agenda, todayVisits, expiring, doneThis, doneLast, withoutNext, tracking] = await Promise.all([
    monthFigures(db, [previousMonth, month]),
    receivables(db, today),
    agendaSummary(db, today),
    listVisits(db, { from: today, to: today }),
    listCertificates(db, today, { expiringWithinDays: 15 }),
    doneVisitsInMonth(db, month),
    doneVisitsInMonth(db, previousMonth),
    clientsWithoutNextVisit(db, today),
    trackingSummary(db, today),
  ]);
  const cur = figures.get(month)!;
  const prev = figures.get(previousMonth)!;
  return {
    today,
    month: {
      month,
      incomeCents: cur.incomeCents,
      expensesCents: cur.expensesCents,
      balanceCents: cur.balanceCents,
      previous: {
        month: previousMonth,
        incomeCents: prev.incomeCents,
        expensesCents: prev.expensesCents,
        balanceCents: prev.balanceCents,
      },
    },
    receivables: {
      owedCents: recv.owedCents,
      overdueCents: recv.overdueCents,
      debtorCount: recv.debtorCount,
      overdueInvoiceCount: recv.overdueInvoiceCount,
    },
    agenda,
    todayVisits: todayVisits.filter((v) => v.status !== 'cancelled'),
    topDebtors: recv.debtors.slice(0, 8).map((d) => ({
      clientId: d.clientId,
      name: d.name,
      phone: d.phone,
      balanceCents: d.balanceCents,
      overdueCents: d.overdueCents,
      daysOverdue: d.daysOverdue,
      agingBucket: d.agingBucket,
    })),
    expiringCertificates: expiring,
    services: { doneThisMonth: doneThis, doneLastMonth: doneLast },
    clientsWithoutNextVisit: withoutNext,
    tracking,
  };
}
