import { loadConfig } from '../config.js';
import { createDb } from './client.js';

const config = loadConfig();
const handle = createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await handle.migrate();
console.log(`Migrations applied (${handle.driver}).`);
await handle.close();
