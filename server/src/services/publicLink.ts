import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { diffDays, type IsoDate } from '@fumigadora/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { certificates, clients } from '../db/schema.js';
import { notFound } from '../http.js';
import { COMPANY_NAME } from '../mail/templates.js';
import { lastVisitDates, nextVisitsByClient, requireClient } from './clients.js';
import { getSettings } from './settings.js';

/** 192 random bits, base64url: far beyond guessable, short enough for a QR. */
export function newPublicToken(): string {
  return randomBytes(24).toString('base64url');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Public site origin. `PUBLIC_BASE_URL` wins; otherwise the origin the request came in on
 * (behind a proxy, the forwarded host/protocol). Null when there is nothing to build a link from.
 */
export function requestOrigin(c: Context): string {
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  if (!host) return new URL(c.req.url).origin;
  return `${proto === 'https' || proto === 'http' ? proto : new URL(c.req.url).protocol.replace(':', '')}://${host.split(',')[0]!.trim()}`;
}

export function publicBaseUrl(config: Config, c: Context): string {
  return (config.publicBaseUrl ?? requestOrigin(c)).replace(/\/+$/, '');
}

export const publicUrl = (base: string, token: string) => `${base}/c/${token}`;

/** The client's token, created on the spot for rows that predate the feature (e.g. a legacy import). */
export async function ensurePublicToken(db: Db, clientId: number): Promise<string> {
  const client = await requireClient(db, clientId);
  if (client.publicToken) return client.publicToken;
  const [row] = await db
    .update(clients)
    .set({ publicToken: newPublicToken() })
    .where(and(eq(clients.id, clientId), isNull(clients.publicToken)))
    .returning({ token: clients.publicToken });
  // Lost a race with another request: read what it stored.
  return row?.token ?? (await requireClient(db, clientId)).publicToken!;
}

/** New token; the previous link stops working immediately. */
export async function regeneratePublicToken(db: Db, clientId: number): Promise<string> {
  await requireClient(db, clientId);
  const [row] = await db.update(clients).set({ publicToken: newPublicToken() }).where(eq(clients.id, clientId)).returning({ token: clients.publicToken });
  return row!.token!;
}

/** Active clients (optionally of one zone) with their public link, ready to print as placards. */
export async function placardList(db: Db, base: string, area?: string) {
  const rows = await db
    .select({ id: clients.id, name: clients.name, address: clients.address, area: clients.area, token: clients.publicToken })
    .from(clients)
    .where(and(isNull(clients.archivedAt), area ? eq(clients.area, area) : undefined));
  const items = [];
  for (const r of rows) {
    const token = r.token ?? (await ensurePublicToken(db, r.id));
    items.push({ id: r.id, name: r.name, address: r.address, area: r.area, token, url: publicUrl(base, token) });
  }
  items.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '', 'es') || a.name.localeCompare(b.name, 'es'));
  return items;
}

/** Zones that have at least one active client, for the bulk-print filter. */
export async function placardZones(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ area: clients.area }).from(clients).where(isNull(clients.archivedAt));
  return rows
    .map((r) => r.area)
    .filter((a): a is string => !!a)
    .sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * What anyone holding the link may see. Deliberately minimal: no amounts, no tax id, no email or phone of the client,
 * no employee names, no notes. Anything added here is published on a building's wall.
 */
export async function publicClientView(db: Db, today: IsoDate, token: string) {
  if (!TOKEN_SHAPE.test(token)) throw notFound('Cliente');
  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.publicToken, token), isNull(clients.archivedAt)));
  if (!client) throw notFound('Cliente');

  const [next, last, [cert], settings] = await Promise.all([
    nextVisitsByClient(db, today, 1, client.id),
    lastVisitDates(db, today, client.id),
    db
      .select({ number: certificates.number, issuedOn: certificates.issuedOn, expiresOn: certificates.expiresOn })
      .from(certificates)
      .where(eq(certificates.clientId, client.id))
      .orderBy(desc(certificates.expiresOn), desc(certificates.id))
      .limit(1),
    getSettings(db),
  ]);
  const nextVisit = next.get(client.id)?.[0];
  return {
    name: client.name,
    nextVisit: nextVisit ? { date: nextVisit.date, time: nextVisit.time, serviceTypeName: nextVisit.serviceTypeName } : null,
    lastVisitDate: last.get(client.id) ?? null,
    certificate: cert
      ? { number: cert.number, issuedOn: cert.issuedOn, expiresOn: cert.expiresOn, valid: cert.expiresOn >= today, daysLeft: diffDays(cert.expiresOn, today) }
      : null,
    company: { name: COMPANY_NAME, phone: settings.companyPhone },
  };
}
