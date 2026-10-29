import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import webpush from 'web-push';
import type { PushConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';

/** What the service worker receives; `tag` makes a newer push replace an older one on the phone. */
export interface PushPayload {
  title: string;
  body: string;
  /** In-app route opened when the notification is tapped. */
  link: string | null;
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one payload to one device. Rejects with `statusCode` 404/410 when the subscription is gone. */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

export interface PushService {
  enabled: boolean;
  send: PushSender;
}

/** The `web-push` transport, signed with the configured VAPID keys. */
function webPushSender(config: PushConfig): PushSender {
  webpush.setVapidDetails(config.subject!, config.publicKey!, config.privateKey!);
  return async (target, payload) => {
    await webpush.sendNotification(target, payload, { TTL: 60 * 60 * 12, timeout: 10_000, urgency: 'high' });
  };
}

/** Push is active only with VAPID configured; a custom `sender` replaces the network transport (tests). */
export function createPushService(config: PushConfig, sender?: PushSender): PushService {
  if (!config.enabled) return { enabled: false, send: async () => {} };
  return { enabled: true, send: sender ?? webPushSender(config) };
}

// One service per database handle, so the single notification create path can push without extra plumbing.
const services = new WeakMap<object, PushService>();

export function registerPush(db: Db, service: PushService) {
  services.set(db, service);
}

export function pushEnabled(db: Db): boolean {
  return services.get(db)?.enabled ?? false;
}

/**
 * Sends a payload to every device of the user. Never throws: the notification it accompanies is already stored.
 * Subscriptions the push service reports as gone (404/410) are deleted.
 */
export async function pushToUser(db: Db, userId: number, payload: PushPayload): Promise<void> {
  const service = services.get(db);
  if (!service?.enabled) return;
  try {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await service.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
          await db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          } else {
            console.error('[push] could not deliver a push', status ?? (error instanceof Error ? error.message : error));
          }
        }
      }),
    );
  } catch (error) {
    console.error('[push] push delivery failed', error);
  }
}

export const subscribeInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});
export const unsubscribeInput = z.object({ endpoint: z.string().url().max(2000) });

/** Registers (or re-registers) a device for the user. The same endpoint on another account moves to this one. */
export async function saveSubscription(db: Db, userId: number, input: z.infer<typeof subscribeInput>, userAgent: string | undefined) {
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    });
  return { ok: true as const };
}

export async function removeSubscription(db: Db, userId: number, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  return { ok: true as const };
}
