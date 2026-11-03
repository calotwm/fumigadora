import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, diffDays, type IsoDate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { certificates, clients, serviceTypes, visits } from '../db/schema.js';
import { zId } from '../http.js';

export const certificateListQuery = z.object({
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  clientId: zId.optional(),
});

/**
 * Certificates with client info and `daysLeft` (negative when expired).
 * A certificate is `superseded` when the same client has a newer one for the same service type.
 * With `expiringWithinDays`, only non-superseded certificates of active clients that expire
 * within that window (or already expired) are returned.
 */
export async function listCertificates(db: Db, today: IsoDate, q: z.infer<typeof certificateListQuery>) {
  const rows = await db
    .select({
      id: certificates.id,
      clientId: certificates.clientId,
      clientName: clients.name,
      clientPhone: clients.phone,
      clientArchived: clients.archivedAt,
      visitId: certificates.visitId,
      number: certificates.number,
      issuedOn: certificates.issuedOn,
      expiresOn: certificates.expiresOn,
      serviceTypeId: serviceTypes.id,
      serviceTypeName: serviceTypes.name,
      fileKey: certificates.fileKey,
    })
    .from(certificates)
    .innerJoin(clients, eq(clients.id, certificates.clientId))
    .leftJoin(visits, eq(visits.id, certificates.visitId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, visits.serviceTypeId))
    .where(and(q.clientId ? eq(certificates.clientId, q.clientId) : undefined, q.expiringWithinDays !== undefined ? isNull(clients.archivedAt) : undefined))
    .orderBy(asc(certificates.expiresOn), asc(certificates.id));

  // Latest expiry per (client, service type).
  const latest = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.clientId}:${r.serviceTypeId ?? 0}`;
    const cur = latest.get(key);
    if (!cur || r.expiresOn > cur) latest.set(key, r.expiresOn);
  }

  const list = rows.map(({ clientArchived, fileKey, ...r }) => ({
    ...r,
    hasFile: fileKey !== null,
    daysLeft: diffDays(r.expiresOn, today),
    superseded: (latest.get(`${r.clientId}:${r.serviceTypeId ?? 0}`) ?? r.expiresOn) > r.expiresOn,
  }));
  if (q.expiringWithinDays === undefined) return list;
  const limit = addDays(today, q.expiringWithinDays);
  return list.filter((c) => !c.superseded && c.expiresOn <= limit);
}

/** Storage key of a certificate's PDF plus the number used for the download name; null file key when none is stored. */
export async function certificateFileInfo(db: Db, id: number) {
  const [row] = await db.select({ number: certificates.number, fileKey: certificates.fileKey }).from(certificates).where(eq(certificates.id, id));
  return row ?? null;
}
