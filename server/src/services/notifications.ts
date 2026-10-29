import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { notifications, type Notification } from '../db/schema.js';
import { notFound } from '../http.js';

const RECENT_LIMIT = 30;

export interface NewNotification {
  userId: number;
  kind: Notification['kind'];
  title: string;
  body: string;
  /** In-app route opened when the notification is clicked. */
  link?: string;
  refType?: string;
  refId?: string;
  /** Business date; part of the dedupe key, so the same event notifies a user once per day. */
  day: IsoDate;
}

export const dedupeKeyOf = (n: Pick<NewNotification, 'userId' | 'kind' | 'refType' | 'refId' | 'day'>) =>
  [n.userId, n.kind, n.refType ?? '', n.refId ?? '', n.day].join(':');

/** Inserts the notification unless one with the same dedupe key exists. Returns the new row, or null when it was a repeat. */
export async function createNotification(db: Db, n: NewNotification): Promise<Notification | null> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: n.userId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      refType: n.refType ?? null,
      refId: n.refId ?? null,
      dedupeKey: dedupeKeyOf(n),
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export function notificationView(n: Notification) {
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt };
}

/** Most recent notifications of a user plus the total number still unread. */
export async function listNotifications(db: Db, userId: number) {
  const [rows, [unread]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(RECENT_LIMIT),
    db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { unreadCount: unread?.n ?? 0, items: rows.map(notificationView) };
}

/** Marks one of the user's notifications as read; someone else's id answers like an unknown one. */
export async function markNotificationRead(db: Db, userId: number, id: number) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (!row) {
    // Already read is fine; unknown or foreign is not.
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!existing) throw notFound('Notificación');
  }
  return { ok: true as const };
}

export async function markAllNotificationsRead(db: Db, userId: number) {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { ok: true as const, updated: rows.length };
}
