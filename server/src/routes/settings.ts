import { Hono } from 'hono';
import { v, type Deps } from '../http.js';
import { getSettings, settingsPatch, updateSettings } from '../services/settings.js';

export function settingsRoutes({ db }: Deps) {
  return new Hono()
    .get('/', async (c) => c.json(await getSettings(db)))
    .put('/', v('json', settingsPatch), async (c) => c.json(await updateSettings(db, c.req.valid('json'))));
}
