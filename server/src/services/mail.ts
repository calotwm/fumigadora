import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { clients, emailLog, EMAIL_KINDS, type EmailLog } from '../db/schema.js';
import { notFound, zId } from '../http.js';
import type { MailProvider } from '../mail/provider.js';
import { testEmail, type RenderedEmail } from '../mail/templates.js';

export const PAGE_SIZE = 25;

export const logQuery = z.object({
  kind: z.enum(EMAIL_KINDS).optional(),
  clientId: zId.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const testInput = z.object({ to: z.string().trim().toLowerCase().email('Ingrese un email válido').max(200) });

export interface SendRequest {
  kind: EmailLog['kind'];
  clientId: number | null;
  to: string;
  email: RenderedEmail;
  refType?: string;
  refId?: string;
  /** Business date recorded in the log. */
  today: IsoDate;
}

/** Sends through the provider and always stores the attempt; a provider failure is recorded, never thrown. */
export async function sendLogged(db: Db, mail: MailProvider, request: SendRequest): Promise<EmailLog> {
  let status: EmailLog['status'] = mail.mode === 'resend' ? 'sent' : 'simulated';
  let error: string | null = null;
  let providerId: string | null = null;
  try {
    const result = await mail.sendEmail({
      to: request.to,
      subject: request.email.subject,
      html: request.email.html,
      text: request.email.text,
      tag: request.kind,
    });
    providerId = result.providerId;
  } catch (e) {
    status = 'failed';
    error = e instanceof Error ? e.message : 'Error desconocido al enviar el mail';
  }
  const [row] = await db
    .insert(emailLog)
    .values({
      kind: request.kind,
      clientId: request.clientId,
      to: request.to,
      subject: request.email.subject,
      html: request.email.html,
      status,
      error,
      providerId,
      refType: request.refType ?? null,
      refId: request.refId ?? null,
      sentOn: request.today,
    })
    .returning();
  return row!;
}

export function emailStatus(mail: MailProvider) {
  return { mode: mail.mode, from: mail.from };
}

export function logView(row: EmailLog & { clientName: string | null }, withHtml = false) {
  const { html, ...rest } = row;
  return { ...rest, ...(withHtml ? { html } : {}) };
}

export async function listLog(db: Db, q: z.infer<typeof logQuery>) {
  const filters: SQL[] = [];
  if (q.kind) filters.push(eq(emailLog.kind, q.kind));
  if (q.clientId) filters.push(eq(emailLog.clientId, q.clientId));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(emailLog).where(where);
  const rows = await db
    .select({ log: emailLog, clientName: clients.name })
    .from(emailLog)
    .leftJoin(clients, eq(clients.id, emailLog.clientId))
    .where(where)
    .orderBy(desc(emailLog.id))
    .limit(PAGE_SIZE)
    .offset((q.page - 1) * PAGE_SIZE);
  return {
    page: q.page,
    pageSize: PAGE_SIZE,
    total,
    items: rows.map((r) => logView({ ...r.log, clientName: r.clientName })),
  };
}

export async function getLog(db: Db, id: number) {
  const [row] = await db
    .select({ log: emailLog, clientName: clients.name })
    .from(emailLog)
    .leftJoin(clients, eq(clients.id, emailLog.clientId))
    .where(eq(emailLog.id, id));
  if (!row) throw notFound('Mail');
  return logView({ ...row.log, clientName: row.clientName }, true);
}

export async function sendTest(db: Db, mail: MailProvider, today: IsoDate, to: string) {
  const row = await sendLogged(db, mail, { kind: 'test', clientId: null, to, email: testEmail(), refType: 'test', today });
  return logView({ ...row, clientName: null });
}
