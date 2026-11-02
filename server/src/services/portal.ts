import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { diffDays, type IsoDate } from '@fumigadora/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { certificates, clientContacts, clientLoginTokens, clients, invoices, payments, serviceTypes, visits } from '../db/schema.js';
import { hhmm } from '../http.js';
import type { MailProvider } from '../mail/provider.js';
import { portalLoginEmail } from '../mail/templates.js';
import { allocationsForPayments, clientDebtMonths, selectInvoices, toInvoiceView, withInvoiceItems } from './accounts.js';
import { clientSummary } from './clients.js';
import { listCertificates } from './certificates.js';
import { sendLogged } from './mail.js';

export const LOGIN_TOKEN_MINUTES = 30;

/** Only the digest is stored: a database leak must not hand out working links. */
export const hashLoginToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface PortalClient {
  id: number;
  name: string;
}

/** Active clients whose own email or one of their contacts' emails is `email` (already lowercased). */
export async function clientsForEmail(db: Db, email: string): Promise<PortalClient[]> {
  const [own, viaContact] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(sql`lower(${clients.email}) = ${email}`, isNull(clients.archivedAt))),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clientContacts)
      .innerJoin(clients, eq(clients.id, clientContacts.clientId))
      .where(and(sql`lower(${clientContacts.email}) = ${email}`, isNull(clients.archivedAt))),
  ]);
  const byId = new Map<number, PortalClient>();
  for (const c of [...own, ...viaContact]) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id - b.id);
}

/**
 * Issues a magic link for `email` when it belongs to at least one client and mails it.
 * Quietly does nothing otherwise: the caller answers the same either way.
 */
export async function sendLoginLink(
  deps: { db: Db; config: Config; mail: MailProvider; today: () => IsoDate; now?: () => Date },
  email: string,
  base: string | null,
): Promise<void> {
  const { db, mail } = deps;
  const matches = await clientsForEmail(db, email);
  if (matches.length === 0) return;
  if (!base) {
    // Without a configured public URL a spoofed Host header could point the link at another site.
    console.error('[portal] PUBLIC_BASE_URL is not set: magic link not sent');
    return;
  }
  const token = randomBytes(32).toString('base64url');
  const now = (deps.now ?? (() => new Date()))();
  await db.insert(clientLoginTokens).values({
    tokenHash: hashLoginToken(token),
    email,
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_MINUTES * 60_000),
  });
  await sendLogged(db, mail, {
    kind: 'portal_login',
    clientId: matches.length === 1 ? matches[0]!.id : null,
    to: email,
    email: portalLoginEmail({ url: `${base}/portal/entrar?token=${encodeURIComponent(token)}`, minutes: LOGIN_TOKEN_MINUTES }),
    refType: 'portal_login',
    today: deps.today(),
  });
}

export type LoginTokenCheck = { ok: true; tokenId: number; clients: PortalClient[] } | { ok: false };

/** A token that exists, is unused and unexpired, and still resolves to at least one active client. */
export async function checkLoginToken(db: Db, token: string, now: Date): Promise<LoginTokenCheck> {
  if (!token || token.length > 200) return { ok: false };
  const [row] = await db.select().from(clientLoginTokens).where(eq(clientLoginTokens.tokenHash, hashLoginToken(token)));
  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) return { ok: false };
  const matches = await clientsForEmail(db, row.email);
  return matches.length > 0 ? { ok: true, tokenId: row.id, clients: matches } : { ok: false };
}

/** Marks the token used. False when someone else used it first (the update is the single-use guarantee). */
export async function consumeLoginToken(db: Db, tokenId: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(clientLoginTokens)
    .set({ usedAt: now })
    .where(and(eq(clientLoginTokens.id, tokenId), isNull(clientLoginTokens.usedAt), sql`${clientLoginTokens.expiresAt} > ${now}`))
    .returning({ id: clientLoginTokens.id });
  return rows.length === 1;
}

// ---------- Read-only views. Every function takes the session's clientId and nothing else to filter by. ----------

/** The home screen: balance, next visits, current oblea. */
export async function portalSummary(db: Db, today: IsoDate, clientId: number) {
  const [summary, certs, debt] = await Promise.all([
    clientSummary(db, today, clientId),
    portalCertificates(db, today, clientId),
    clientDebtMonths(db, clientId),
  ]);
  const current = certs.find((c) => !c.superseded) ?? certs[0] ?? null;
  return {
    balanceCents: summary.balanceCents,
    openCents: summary.openCents,
    overdueCents: summary.overdueCents,
    creditCents: summary.creditCents,
    daysOverdue: summary.daysOverdue,
    overdueInvoiceCount: summary.overdueInvoiceCount,
    months: debt.months.map((m) => ({ month: m.month, billedCents: m.billedCents, paidCents: m.paidCents, owedCents: m.owedCents })),
    nextVisits: summary.nextVisits.map((v) => ({ id: v.id, date: v.date, time: v.time, serviceTypeName: v.serviceTypeName })),
    lastVisitDate: summary.lastVisitDate,
    certificate: current,
  };
}

/** Visit history, newest first. No notes, prices, cancel reasons or employee names. */
export async function portalVisits(db: Db, clientId: number) {
  const rows = await db
    .select({ id: visits.id, date: visits.date, time: visits.time, status: visits.status, serviceTypeName: serviceTypes.name })
    .from(visits)
    .innerJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
    .where(eq(visits.clientId, clientId))
    .orderBy(desc(visits.date), desc(visits.id))
    .limit(300);
  return rows.map((r) => ({ ...r, time: hhmm(r.time) }));
}

/** Non-voided invoices with their lines, newest first. ARCA internals stay out. */
export async function portalInvoices(db: Db, today: IsoDate, clientId: number) {
  const rows = await selectInvoices(db, and(eq(invoices.clientId, clientId), isNull(invoices.voidedAt)));
  const views = await withInvoiceItems(
    db,
    rows.map((r) => toInvoiceView(r, today)),
  );
  return views
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.id - a.id)
    .map((i) => ({
      id: i.id,
      number: i.number,
      issuedOn: i.issuedOn,
      dueOn: i.dueOn,
      description: i.description,
      amountCents: i.amountCents,
      paidCents: i.paidCents,
      balanceCents: i.balanceCents,
      status: i.status,
      daysOverdue: i.daysOverdue,
      items: i.items,
    }));
}

export async function portalPayments(db: Db, clientId: number) {
  const rows = await db.select().from(payments).where(eq(payments.clientId, clientId)).orderBy(desc(payments.paidOn), desc(payments.id));
  const allocs = await allocationsForPayments(
    db,
    rows.map((p) => p.id),
  );
  return rows.map((p) => ({
    id: p.id,
    paidOn: p.paidOn,
    amountCents: p.amountCents,
    method: p.method,
    allocations: (allocs.get(p.id) ?? []).map((a) => ({ invoiceNumber: a.invoiceNumber, amountCents: a.amountCents })),
  }));
}

export async function portalCertificates(db: Db, today: IsoDate, clientId: number) {
  const list = await listCertificates(db, today, { clientId });
  return list
    .sort((a, b) => b.expiresOn.localeCompare(a.expiresOn) || b.id - a.id)
    .map((c) => ({
      id: c.id,
      number: c.number,
      issuedOn: c.issuedOn,
      expiresOn: c.expiresOn,
      serviceTypeName: c.serviceTypeName,
      hasFile: c.hasFile,
      valid: c.expiresOn >= today,
      daysLeft: diffDays(c.expiresOn, today),
      superseded: c.superseded,
    }));
}

/** File key and number of a certificate, only when it belongs to the client (anything else looks like a missing one). */
export async function ownCertificateFile(db: Db, clientId: number, certificateId: number) {
  const [row] = await db
    .select({ number: certificates.number, fileKey: certificates.fileKey })
    .from(certificates)
    .where(and(eq(certificates.id, certificateId), eq(certificates.clientId, clientId)));
  return row ?? null;
}
