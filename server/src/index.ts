import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

const config = loadConfig();
const handle = createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await handle.migrate();

const app = createApp({ db: handle.db, config });
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Fumigadora listening on http://localhost:${info.port} (db: ${handle.driver})`);
});

async function shutdown() {
  server.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
