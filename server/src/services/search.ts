import { and, asc, ilike, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { likePattern } from '../http.js';

/** Client lookup for the command palette. */
export async function searchClients(db: Db, q: string, limit = 10) {
  const pattern = likePattern(q);
  return db
    .select({
      id: clients.id,
      name: clients.name,
      kind: clients.kind,
      address: clients.address,
      phone: clients.phone,
    })
    .from(clients)
    .where(
      and(
        isNull(clients.archivedAt),
        or(ilike(clients.name, pattern), ilike(clients.address, pattern), ilike(clients.phone, pattern), ilike(clients.contactName, pattern)),
      ),
    )
    .orderBy(asc(clients.name))
    .limit(limit);
}
