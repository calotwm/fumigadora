import { Hono } from 'hono';
import { idParam, notFound, v, type Deps } from '../http.js';
import {
  clientBaitStations,
  createDocument,
  createStation,
  deleteDocument,
  deleteStation,
  documentFields,
  documentFileInfo,
  removeStationPhoto,
  setStationPhoto,
  stationInput,
  stationListQuery,
  stationPatch,
  stationPhotoInfo,
  updateStation,
} from '../services/baitStations.js';
import { readStoredFile } from '../services/files.js';
import { checkUpload, fileResponse, IMAGE_TYPES, parseFields, PDF_TYPES, readForm, uploadLimit } from '../services/uploads.js';

export const PHOTO_MESSAGES = { missing: 'Adjuntá la foto', wrongType: 'La foto debe ser una imagen JPG, PNG, WEBP o HEIC' };

/** Bait stations of a client (owner only). Employees read them through `/api/me`. */
export function baitStationRoutes({ db, config }: Deps) {
  return new Hono()
    .get('/', v('query', stationListQuery), async (c) => c.json(await clientBaitStations(db, c.req.valid('query').clientId)))
    .post('/', v('json', stationInput), async (c) => c.json(await createStation(db, c.req.valid('json')), 201))
    .patch('/:id', v('param', idParam), v('json', stationPatch), async (c) =>
      c.json(await updateStation(db, c.req.valid('param').id, c.req.valid('json'))),
    )
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteStation(db, config.filesDir, c.req.valid('param').id)))
    .put('/:id/photo', uploadLimit(), v('param', idParam), async (c) => {
      const { files } = await readForm(c);
      const photo = await checkUpload(files.photo, IMAGE_TYPES, PHOTO_MESSAGES);
      return c.json(await setStationPhoto(db, config.filesDir, c.req.valid('param').id, photo));
    })
    .delete('/:id/photo', v('param', idParam), async (c) => c.json(await removeStationPhoto(db, config.filesDir, c.req.valid('param').id)))
    .get('/:id/photo', v('param', idParam), async (c) => {
      const info = await stationPhotoInfo(db, c.req.valid('param').id);
      const bytes = info ? await readStoredFile(config.filesDir, info.key) : null;
      if (!info || !bytes) throw notFound('Foto del cebadero');
      return fileResponse(c, bytes, info.type, `cebadero-${info.code}.${info.key.split('.').pop()}`);
    });
}

/** PDF documents of a client, e.g. the bait-station plan (owner only). Listed by `GET /api/bait-stations`. */
export function clientDocumentRoutes({ db, config }: Deps) {
  return new Hono()
    .post('/', uploadLimit(), async (c) => {
      const { fields, files } = await readForm(c);
      const input = parseFields(documentFields, fields);
      const file = await checkUpload(files.file, PDF_TYPES, { missing: 'Adjuntá el PDF', wrongType: 'El documento debe ser un PDF' });
      return c.json(await createDocument(db, config.filesDir, input, files.file!.name, file), 201);
    })
    .get('/:id/file', v('param', idParam), async (c) => {
      const doc = await documentFileInfo(db, c.req.valid('param').id);
      const bytes = doc ? await readStoredFile(config.filesDir, doc.key) : null;
      if (!doc || !bytes) throw notFound('Documento');
      return fileResponse(c, bytes, 'application/pdf', doc.name.toLowerCase().endsWith('.pdf') ? doc.name : `${doc.name}.pdf`);
    })
    .delete('/:id', v('param', idParam), async (c) => c.json(await deleteDocument(db, config.filesDir, c.req.valid('param').id)));
}
