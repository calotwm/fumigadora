import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { baitStations, clientDocuments, clients, visits } from '../db/schema.js';
import { badRequest, notFound, zId } from '../http.js';
import { deleteStoredFile, writeStoredFile } from './files.js';
import type { Upload } from './uploads.js';

export const stationListQuery = z.object({ clientId: zId });
export const stationInput = z.object({
  clientId: zId,
  code: z.string().trim().min(1, 'Indicá el número o código').max(40),
  reference: z.string().trim().max(500).default(''),
});
export const stationPatch = z.object({
  code: z.string().trim().min(1, 'Indicá el número o código').max(40).optional(),
  reference: z.string().trim().max(500).optional(),
});
export const documentFields = z.object({
  clientId: zId,
  name: z.string().trim().max(120).optional(),
});

const stationSelect = {
  id: baitStations.id,
  clientId: baitStations.clientId,
  code: baitStations.code,
  reference: baitStations.reference,
  hasPhoto: sql<boolean>`${baitStations.photoKey} is not null`,
};
const documentSelect = {
  id: clientDocuments.id,
  clientId: clientDocuments.clientId,
  name: clientDocuments.name,
  size: clientDocuments.fileSize,
  createdAt: clientDocuments.createdAt,
};

/** Natural order for codes like E2 < E10. */
const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, 'es', { numeric: true });

async function assertClient(db: Db, id: number) {
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
  if (!row) throw badRequest('El cliente indicado no existe');
}

async function getStation(db: Db, id: number) {
  const [row] = await db.select(stationSelect).from(baitStations).where(eq(baitStations.id, id));
  if (!row) throw notFound('Cebadero');
  return row;
}

/** Stations and PDF documents of a client (owner view). */
export async function clientBaitStations(db: Db, clientId: number) {
  const [stations, documents] = await Promise.all([
    db.select(stationSelect).from(baitStations).where(eq(baitStations.clientId, clientId)),
    db.select(documentSelect).from(clientDocuments).where(eq(clientDocuments.clientId, clientId)).orderBy(desc(clientDocuments.id)),
  ]);
  return { stations: stations.sort(byCode), documents };
}

export async function createStation(db: Db, input: z.infer<typeof stationInput>) {
  await assertClient(db, input.clientId);
  const [row] = await db.insert(baitStations).values(input).returning({ id: baitStations.id });
  return getStation(db, row!.id);
}

export async function updateStation(db: Db, id: number, patch: z.infer<typeof stationPatch>) {
  await getStation(db, id);
  if (patch.code !== undefined || patch.reference !== undefined) {
    await db
      .update(baitStations)
      .set({ ...(patch.code !== undefined ? { code: patch.code } : {}), ...(patch.reference !== undefined ? { reference: patch.reference } : {}) })
      .where(eq(baitStations.id, id));
  }
  return getStation(db, id);
}

export async function deleteStation(db: Db, filesDir: string, id: number) {
  await getStation(db, id);
  const [row] = await db.delete(baitStations).where(eq(baitStations.id, id)).returning({ photoKey: baitStations.photoKey });
  if (row?.photoKey) await deleteStoredFile(filesDir, row.photoKey);
  return { ok: true as const };
}

/** Stores (or replaces) the station's photo as `bait-stations/<id>.<ext>`. */
export async function setStationPhoto(db: Db, filesDir: string, id: number, photo: Upload) {
  const [current] = await db.select({ photoKey: baitStations.photoKey }).from(baitStations).where(eq(baitStations.id, id));
  if (!current) throw notFound('Cebadero');
  const key = `bait-stations/${id}.${photo.ext}`;
  await writeStoredFile(filesDir, key, photo.bytes);
  if (current.photoKey && current.photoKey !== key) await deleteStoredFile(filesDir, current.photoKey);
  await db.update(baitStations).set({ photoKey: key, photoType: photo.type }).where(eq(baitStations.id, id));
  return getStation(db, id);
}

export async function removeStationPhoto(db: Db, filesDir: string, id: number) {
  const [current] = await db.select({ photoKey: baitStations.photoKey }).from(baitStations).where(eq(baitStations.id, id));
  if (!current) throw notFound('Cebadero');
  if (current.photoKey) await deleteStoredFile(filesDir, current.photoKey);
  await db.update(baitStations).set({ photoKey: null, photoType: null }).where(eq(baitStations.id, id));
  return getStation(db, id);
}

/** Storage info of a station photo; null when the station or its photo does not exist. */
export async function stationPhotoInfo(db: Db, id: number) {
  const [row] = await db
    .select({ clientId: baitStations.clientId, code: baitStations.code, key: baitStations.photoKey, type: baitStations.photoType })
    .from(baitStations)
    .where(eq(baitStations.id, id));
  return row?.key && row.type ? { clientId: row.clientId, code: row.code, key: row.key, type: row.type } : null;
}

/** Display name: the one typed, else the uploaded file's base name (never used for the stored path). */
function documentName(typed: string | undefined, fileName: string): string {
  const base = fileName.split(/[\\/]/).pop()?.trim() ?? '';
  return (typed || base || 'Documento').slice(0, 120);
}

export async function createDocument(db: Db, filesDir: string, fields: z.infer<typeof documentFields>, fileName: string, file: Upload) {
  await assertClient(db, fields.clientId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clientDocuments)
      .values({ clientId: fields.clientId, name: documentName(fields.name, fileName), fileKey: '', fileSize: file.bytes.length })
      .returning({ id: clientDocuments.id });
    const key = `client-documents/${row!.id}.${file.ext}`;
    await writeStoredFile(filesDir, key, file.bytes);
    await tx.update(clientDocuments).set({ fileKey: key }).where(eq(clientDocuments.id, row!.id));
    const [doc] = await tx.select(documentSelect).from(clientDocuments).where(eq(clientDocuments.id, row!.id));
    return doc!;
  });
}

export async function documentFileInfo(db: Db, id: number) {
  const [row] = await db.select({ name: clientDocuments.name, key: clientDocuments.fileKey }).from(clientDocuments).where(eq(clientDocuments.id, id));
  return row ?? null;
}

export async function deleteDocument(db: Db, filesDir: string, id: number) {
  const [row] = await db.delete(clientDocuments).where(eq(clientDocuments.id, id)).returning({ key: clientDocuments.fileKey });
  if (!row) throw notFound('Documento');
  await deleteStoredFile(filesDir, row.key);
  return { ok: true as const };
}

// ---------- employee (read-only) ----------

/** Stations of the client of one of the caller's visits. Unknown and foreign visits answer the same 404. */
export async function myVisitStations(db: Db, userId: number, visitId: number) {
  const [visit] = await db
    .select({ clientId: visits.clientId, clientName: clients.name, assignedUserId: visits.assignedUserId })
    .from(visits)
    .innerJoin(clients, eq(clients.id, visits.clientId))
    .where(eq(visits.id, visitId));
  if (!visit || visit.assignedUserId !== userId) throw notFound('Visita');
  const stations = await db
    .select({ id: baitStations.id, code: baitStations.code, reference: baitStations.reference, hasPhoto: stationSelect.hasPhoto })
    .from(baitStations)
    .where(eq(baitStations.clientId, visit.clientId))
    .orderBy(asc(baitStations.id));
  return { clientId: visit.clientId, clientName: visit.clientName, stations: stations.sort(byCode) };
}

/** True when the caller has (or had) a visit assigned at that client: the only way they may see its station photos. */
export async function hasVisitAtClient(db: Db, userId: number, clientId: number) {
  const [row] = await db
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.clientId, clientId), eq(visits.assignedUserId, userId)))
    .limit(1);
  return !!row;
}
