import { and, eq } from 'drizzle-orm';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, users, type Notification } from '../db/schema.js';
import type { MailProvider } from '../mail/provider.js';
import { ownerNotificationEmail } from '../mail/templates.js';
import { sendLogged } from './mail.js';
import { createNotification } from './notifications.js';

export interface AdminNotice {
  kind: Notification['kind'];
  title: string;
  body: string;
  link?: string;
  refType?: string;
  refId?: string;
  /** Business date: with the kind and ref it makes the notice once-per-day per admin. */
  day: IsoDate;
}

/**
 * Notifies every active admin user: always in the bell, and by email when the admin has an address.
 * Reruns are safe: an admin who already got this notice today is neither notified nor mailed again.
 */
export async function notifyAdmins(db: Db, mail: MailProvider, notice: AdminNotice): Promise<{ created: number; emailed: number }> {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true)));
  let created = 0;
  let emailed = 0;
  for (const admin of admins) {
    const row = await createNotification(db, { ...notice, userId: admin.id });
    if (!row) continue;
    created += 1;
    if (!admin.email) continue;
    await sendLogged(db, mail, {
      kind: 'owner_notification',
      clientId: null,
      to: admin.email,
      email: ownerNotificationEmail({ title: notice.title, body: notice.body }),
      refType: 'notification',
      refId: String(row.id),
      today: notice.day,
    });
    emailed += 1;
  }
  return { created, emailed };
}

/** A client email could not be sent: tell the admins once per client, kind and day (daily retries do not pile up). */
export async function notifyClientEmailFailed(
  db: Db,
  mail: MailProvider,
  failure: { clientId: number; emailKind: string; to: string; error: string | null; day: IsoDate },
) {
  const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, failure.clientId));
  const what = failure.emailKind === 'debt_reminder' ? 'el recordatorio de deuda' : 'el aviso de servicio';
  await notifyAdmins(db, mail, {
    kind: 'client_email_failed',
    title: 'No se pudo enviar un mail a un cliente',
    body: `No se pudo enviar ${what} a ${client?.name ?? 'un cliente'} (${failure.to}).${failure.error ? ` Motivo: ${failure.error}` : ''}`,
    link: `/clientes/${failure.clientId}`,
    refType: 'email_failed',
    refId: `${failure.clientId}:${failure.emailKind}`,
    day: failure.day,
  });
}
