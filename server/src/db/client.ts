import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  /** Applies committed SQL migrations. */
  migrate(): Promise<void>;
  close(): Promise<void>;
  driver: 'postgres' | 'pglite';
}

/** Locates the committed drizzle migrations folder from src (dev/tests) or dist (bundled build). */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../drizzle'), // server/src/db -> server/drizzle
    resolve(here, '../drizzle'), // server/dist -> server/drizzle
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'server/drizzle'),
  ];
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (looked in: ${candidates.join(', ')})`);
  return found;
}

export interface CreateDbOptions {
  databaseUrl?: string | undefined;
  /** PGlite data dir; `memory://` (default for tests) keeps it in memory. */
  pgliteDir?: string;
}

export function createDb(options: CreateDbOptions = {}): DbHandle {
  if (options.databaseUrl) {
    const client = postgres(options.databaseUrl, { max: 10 });
    const db = drizzlePostgres(client, { schema });
    return {
      db,
      driver: 'postgres',
      migrate: () => migratePostgres(db, { migrationsFolder: migrationsFolder() }),
      close: () => client.end(),
    };
  }
  const dir = options.pgliteDir ?? 'memory://';
  if (!dir.startsWith('memory://')) mkdirSync(resolve(dir), { recursive: true });
  const client = new PGlite(dir.startsWith('memory://') ? undefined : resolve(dir));
  const db = drizzlePglite(client, { schema });
  return {
    db,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}
