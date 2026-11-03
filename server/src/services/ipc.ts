import { asc, desc, sql } from 'drizzle-orm';
import type { IpcRate } from '@fumigadora/shared';
import type { Db } from '../db/client.js';
import { ipcMonths } from '../db/schema.js';

/** Argly: free community API that republishes INDEC's monthly IPC (`valor` = monthly % variation). */
export const ARGLY_IPC_URL = 'https://api.argly.com.ar/v1/ipc?historico=true';

interface ArglyIpcRow {
  mes?: unknown;
  anio?: unknown;
  valor?: unknown;
}

/** Valid rows of an Argly answer as rates; anything malformed is skipped. */
export function parseArglyIpc(body: unknown): IpcRate[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  return (rows as ArglyIpcRow[]).flatMap((r) => {
    const month = Number(r.mes);
    const year = Number(r.anio);
    const value = Number(r.valor);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) return [];
    if (r.valor === null || r.valor === '' || !Number.isFinite(value)) return [];
    return [{ month: `${year}-${String(month).padStart(2, '0')}`, percentBp: Math.round(value * 100) }];
  });
}

/**
 * Downloads the whole IPC history from Argly and upserts it (INDEC may revise a month). Throws when the service
 * fails or answers nothing usable, so the caller can retry later; the stored months stay as they were.
 */
export async function syncIpc(db: Db, fetchFn: typeof fetch): Promise<{ months: number; latest: string }> {
  const res = await fetchFn(ARGLY_IPC_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Argly IPC answered ${res.status}`);
  const rates = parseArglyIpc(await res.json());
  if (rates.length === 0) throw new Error('Argly IPC answered no months');
  await db
    .insert(ipcMonths)
    .values(rates)
    .onConflictDoUpdate({ target: ipcMonths.month, set: { percentBp: sql`excluded.percent_bp`, updatedAt: sql`now()` } });
  return { months: rates.length, latest: rates.reduce((a, r) => (r.month > a ? r.month : a), '') };
}

/** Last published month, as a percent (1.9 = 1.9 %); null until the IPC was synced. */
export async function latestIpc(db: Db): Promise<{ month: string; percent: number } | null> {
  const [row] = await db.select().from(ipcMonths).orderBy(desc(ipcMonths.month)).limit(1);
  return row ? { month: row.month, percent: row.percentBp / 100 } : null;
}

export async function listIpcRates(db: Db): Promise<IpcRate[]> {
  return db.select({ month: ipcMonths.month, percentBp: ipcMonths.percentBp }).from(ipcMonths).orderBy(asc(ipcMonths.month));
}
