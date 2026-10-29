import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatMoney } from '@fumigadora/shared';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { importLegacy, type EntityCounts, type ImportReport, type LegacyExport, type LegacyFilesBundle } from './services/legacyImport.js';

const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/legacy/plagamix-legacy-export.json');
const DEFAULT_FILES = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/legacy/plagamix-legacy-files.json');

const { values } = parseArgs({
  options: {
    file: { type: 'string', default: DEFAULT_FILE },
    files: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'allow-mismatches': { type: 'boolean', default: false },
  },
});

function line(label: string, c: EntityCounts): string {
  return `  ${label.padEnd(13)} inserted ${c.inserted}, updated ${c.updated}, skipped ${c.skipped}`;
}

function print(report: ImportReport, hasFiles: boolean): void {
  const { ledger, reconciliation: rec } = report;
  console.log(`Legacy import ${report.dryRun ? '(dry run, rolled back)' : report.committed ? '(committed)' : '(ROLLED BACK)'}`);
  console.log(line('clients', report.clients));
  console.log(line('contacts', report.contacts));
  console.log(line('visits', report.visits));
  console.log(line('certificates', report.certificates));
  console.log(line('invoices', report.invoices));
  console.log(line('payments', report.payments));
  if (hasFiles) {
    const f = report.files;
    console.log(`  files: ${f.written} ${report.committed ? 'written' : 'to write'}, ${f.skipped} skipped, ${f.missing} without a matching certificate`);
  }
  console.log(`  service types created: ${report.serviceTypesCreated}, allocations inserted: ${report.allocationsInserted}`);
  console.log(
    `  ledger: ${ledger.charges} charges, ${ledger.payments} payments, ${ledger.zeroSkipped} zero charges skipped, ` +
      `${ledger.negativeCredits} negative charges imported as credits, ${ledger.emptyPaymentsSkipped} empty payments skipped`,
  );
  console.log(`Reconciliation: ${rec.matched}/${rec.clients} clients match the legacy balance, ${rec.mismatches.length} mismatches`);
  for (const m of rec.mismatches) {
    console.log(`  legacy client ${m.legacyId}: computed ${formatMoney(m.computedCents)} vs legacy ${formatMoney(m.legacyCents)}`);
  }
}

const data = JSON.parse(readFileSync(resolve(values.file ?? DEFAULT_FILE), 'utf8')) as LegacyExport;
// --files <bundle>, or the default bundle when it exists; otherwise the files step is skipped.
const filesPath = values.files ? resolve(values.files) : existsSync(DEFAULT_FILES) ? DEFAULT_FILES : undefined;
const files = filesPath ? (JSON.parse(readFileSync(filesPath, 'utf8')) as LegacyFilesBundle) : undefined;
if (!files) console.log('No files bundle found (pass --files <path>): certificate PDFs are skipped.');
const config = loadConfig();
const handle = createDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
let exitCode = 0;
try {
  await handle.migrate();
  const report = await importLegacy(handle.db, data, {
    dryRun: values['dry-run'] ?? false,
    allowMismatches: values['allow-mismatches'] ?? false,
    ...(files ? { files, filesDir: resolve(config.filesDir) } : {}),
  });
  print(report, files !== undefined);
  // A mismatch always fails the run (the dry run included); a real run also rolls back unless --allow-mismatches.
  if (report.reconciliation.mismatches.length > 0) exitCode = 1;
} catch (error) {
  console.error('Legacy import failed:', error);
  exitCode = 1;
} finally {
  await handle.close();
}
process.exit(exitCode);
