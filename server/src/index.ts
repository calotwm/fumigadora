import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { today as businessToday } from '@fumigadora/shared';
import { createDb } from './db/client.js';
import { createMailProvider } from './mail/provider.js';
import { startDailyScheduler } from './services/jobs.js';

const config = loadConfig();
const handle = createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await handle.migrate();

const mail = createMailProvider(config.mail);
console.log(`[mail] mode: ${mail.mode}`);
const app = createApp({ db: handle.db, config, mail });
const stopScheduler = startDailyScheduler({ db: handle.db, config, mail, today: () => businessToday() });
const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Fumigadora listening on http://localhost:${info.port} (db: ${handle.driver})`);
});

async function shutdown() {
  stopScheduler();
  server.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
