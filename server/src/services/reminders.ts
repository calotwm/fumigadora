import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { reminderDecision, type IsoDate, type ReminderSkipReason } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, emailLog } from '../db/schema.js';
import type { Deps } from '../http.js';
import { debtReminderEmail } from '../mail/templates.js';
import { openInvoiceRows } from './accounts.js';
import { sendLogged } from './mail.js';
import { listDebtors } from './receivables.js';
import { getSettings, reminderRules } from './settings.js';

export interface ReminderRecipient {
  clientId: number;
  name: string;
  email: string;
  overdueCents: number;
  daysOverdue: number;
  overdueInvoiceCount: number;
  lastReminderOn: IsoDate | null;
}

/** Who would get a debt reminder today. `force` ignores the on/off switch (manual "send now" and the preview). */
export async function reminderPlan(db: Db, today: IsoDate, force: boolean) {
  const rules = reminderRules(await getSettings(db));
  const effective = { ...rules, enabled: force || rules.enabled };
  const debtors = (await listDebtors(db, today)).filter((d) => d.overdueCents > 0);
  const ids = debtors.map((d) => d.clientId);
  const info =
    ids.length === 0
      ? []
      : await db.select({ id: clients.id, email: clients.email }).from(clients).where(and(inArray(clients.id, ids), isNull(clients.archivedAt)));
  const emailOf = new Map(info.map((c) => [c.id, c.email]));
  const lastRows =
    ids.length === 0
      ? []
      : await db
          .select({ clientId: emailLog.clientId, last: max(emailLog.sentOn) })
          .from(emailLog)
          .where(and(eq(emailLog.kind, 'debt_reminder'), inArray(emailLog.status, ['sent', 'simulated']), inArray(emailLog.clientId, ids)))
          .groupBy(emailLog.clientId);
  const lastBy = new Map(lastRows.map((r) => [r.clientId, r.last]));

  const recipients: ReminderRecipient[] = [];
  const skipped: Record<ReminderSkipReason, number> = { disabled: 0, no_email: 0, not_overdue: 0, not_late_enough: 0, too_recent: 0 };
  for (const d of debtors) {
    if (!emailOf.has(d.clientId)) continue; // archived
    const email = emailOf.get(d.clientId) ?? null;
    const lastReminderOn = lastBy.get(d.clientId) ?? null;
    const decision = reminderDecision({ email, overdueCents: d.overdueCents, daysOverdue: d.daysOverdue, lastReminderOn }, effective, today);
    if (decision.send) {
      recipients.push({
        clientId: d.clientId,
        name: d.name,
        email: email!.trim().toLowerCase(),
        overdueCents: d.overdueCents,
        daysOverdue: d.daysOverdue,
        overdueInvoiceCount: d.overdueInvoiceCount,
        lastReminderOn,
      });
    } else skipped[decision.reason]++;
  }
  return { rules, recipients, skipped };
}

export async function reminderPreview(db: Db, today: IsoDate) {
  const { rules, recipients, skipped } = await reminderPlan(db, today, true);
  return { today, enabled: rules.enabled, everyDays: rules.everyDays, minDaysOverdue: rules.minDaysOverdue, recipients, skipped };
}

export interface ReminderSummary {
  sent: number;
  simulated: number;
  failed: number;
}

/** Sends the reminders due today. The daily job respects the switch; `force` is the manual "send now". */
export async function sendDebtReminders(deps: Deps, force = false): Promise<ReminderSummary> {
  const { db, mail } = deps;
  const today = deps.today();
  const summary: ReminderSummary = { sent: 0, simulated: 0, failed: 0 };
  const { recipients } = await reminderPlan(db, today, force);
  for (const r of recipients) {
    const overdue = (await openInvoiceRows(db, r.clientId))
      .map((i) => ({ number: i.number, dueOn: i.dueOn, balanceCents: i.amountCents - i.paidCents }))
      .filter((i) => i.dueOn < today)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    if (overdue.length === 0) continue;
    const log = await sendLogged(db, mail, {
      kind: 'debt_reminder',
      clientId: r.clientId,
      to: r.email,
      email: debtReminderEmail({ clientName: r.name, invoices: overdue, totalCents: overdue.reduce((s, i) => s + i.balanceCents, 0) }),
      refType: 'debt_reminder',
      refId: today,
      today,
    });
    summary[log.status]++;
  }
  return summary;
}
