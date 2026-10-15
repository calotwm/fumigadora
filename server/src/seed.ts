import { today } from '@fumigadora/shared';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runSeed, SEED_EMPLOYEE_PASSWORD } from './seed-data.js';

const config = loadConfig();
if (config.isProduction && process.env.ALLOW_SEED !== 'true') {
  console.error('Refusing to seed in production (set ALLOW_SEED=true to override). This wipes ALL data.');
  process.exit(1);
}

const handle = createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
await handle.migrate();
const summary = await runSeed(handle.db, today());
console.log('Seed complete:', summary);
if (!config.isProduction) {
  console.log(`Employee logins (development only): ${summary.employees.join(', ')} / password "${SEED_EMPLOYEE_PASSWORD}"`);
}
await handle.close();
