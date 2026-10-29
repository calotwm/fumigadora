# Feature: legacy-import

## Objective
Import the legacy system (gestion.plagamix.com) data into this app: clients, contacts, visits, obleas (certificates), charges and payments, so the owner can switch systems without losing history or debt.

## Problem / why
The client wants to stop using the legacy system. Debt must match the legacy balance per client exactly, and the full monthly history is needed for the per-month debt features (meeting items 1 and 2).

## Source
Export JSON captured from the legacy API (read-only GETs, passwords and tokens stripped) at `server/.data/legacy/plagamix-legacy-export.json` (gitignored, never committed: client private data). Shape: `{ exportedAt, catalogs{categories,methods,appointmentTypes,appointmentStatus,taxConditions,cities,employees}, bills, monthlyTotals, ledgerRecent, customers[{summary, detail{...,Certificates,Appointments}, currentAccount[], contacts[]}] }`.

Counts: 303 customers, 9,295 ledger rows (5,006 charges, 4,289 payments), 959 appointments, 279 certificates (273 with PDF), 98 contacts, 6 ARCA bills.

## Verified legacy semantics (2026-10-29)
- Ledger row `currentAccount` is the signed amount of that row, not a running balance. For all 303 customers, `sum(currentAccount) == customer.balance` (total debt ARS 10,122,092.78; 5 customers with negative balance = credit).
- Charge: `executed=false`, `debit` 0/null, `currentAccount` > 0 (3 rows are zero or negative).
- Payment: `executed=true`, `debit = amount`, `currentAccount = -debit`, `paymentMethodId` 1 Efectivo, 2 Transferencia, 3 Cheque, 4 Mercado Pago, 5 Banco, or null.
- Amounts are pesos with decimals (99 fractional, some float artifacts): round to integer cents.
- Dates are UTC ISO strings; convert to Argentina local date (UTC-3).
- Appointment status: 1 Pendiente, 2 Realizada, 3 A concretar, 4 Cancelada. Types: Fumigación, Desinfección, Recarga de matafuego, Limpieza de tanque, Limpieza de frente, Limpieza de consorcio.
- Tax condition ids: 1 Responsable Inscripto, 2 Exento, 3 Monotributo, 4 Consumidor final, 0 unset. `legalIdType`: 80 CUIT, 86 CUIL, 0 none.

## Scope
- Schema additions: `legacy_id` on imported tables (idempotency), client location fields (city, province, postal code, latitude, longitude), multiple contacts per client, certificate description and legacy file url.
- Pure mapper in `shared` (legacy record -> domain rows).
- Import script `db:import-legacy` with dry-run and reconciliation report.
- Out of scope here: copying oblea PDFs to new storage (I5, needs a storage decision), running on production (I6, after first Railway deploy), legacy ARCA bills beyond keeping their data, payment receipt attachments.

## Decisions (defaults, revisable)
- Full history, not an opening balance: each charge -> invoice, each payment -> payment, allocated FIFO with the existing `allocatePayment`. Gives per-month debt for free.
- Imported invoices get number `L-<legacyId>`; `issued_on = due_on =` charge date; `period_month` from the charge date.
- Zero charges skipped; negative charges imported as a credit (payment, method other) and reported.
- Imported payments are already settled: `handed_over_at = paid_on`. Method map: 1 cash, 2 transfer, 3 check, 4 mercadopago, 5 transfer, null other.
- Visit status: 1 and 3 -> scheduled, 2 -> done, 4 -> cancelled. Service types matched by name, created if missing. Legacy employees are not mapped to users (assigned user null).
- Client kind: `building` if the name starts with "Consorcio" (case-insensitive), else `business`. Zone (`area`) from legacy city.
- Importer never truncates; re-running upserts by `legacy_id`.

## TDD
Mode: off (project convention, see plagamix-etapas). Runner: Vitest (`npm test`). Ordinary functional checks per task.

## Delivery
Branch `feat/legacy-import` (from main b849b2a). Strategy: ask-on-risk; forecast above 400 lines. Work-unit commits per task; PR slicing decided with the user before opening PRs. RDD disabled globally by user.

## Tasks
- [x] I1 Schema: `legacy_id` columns, client location fields, `client_contacts` table, certificate description + legacy file url; Drizzle migration. Route: delegated (one writer for I1+I2+I4, 2+ non-trivial files).
- [x] I2 Pure mapper in `shared/src/legacy.ts` with fixture tests (money, dates, statuses, tax ids, ledger split into invoices/payments). Route: delegated.
- [x] I3 Ledger semantics verified against legacy balances (see above). Route: inline (analysis only).
- [x] I4 `server/src/import-legacy.ts` + `npm run db:import-legacy` (`--dry-run`, `--file`), transactional, idempotent, reconciliation report (per-client computed debt vs legacy balance). Route: delegated.
- [x] I5 Oblea PDFs on a Railway volume (decided 2026-10-29). Legacy serves files only through the authenticated API (`/files/byIdNoHeader/:fileId`, base64), so the 273 PDFs were fetched from the logged-in browser into `server/.data/legacy/plagamix-legacy-files.json` (gitignored, 116 MB, `{exportedAt, files: {<legacyFileId>: {certificateId, name, extension, base64}}}`, all verified `%PDF`). Build: `FILES_DIR` config (default `server/.data/files`; production = volume mount path), certificate file column, importer `--files <bundle>` writes PDFs idempotently, authenticated download endpoint, "Ver PDF" link in the client's certificates, deploy docs for the volume. Route: delegated (one writer, 2+ non-trivial files).
- [ ] I6 Run the import on production after the first Railway deploy.

## Acceptance criteria
- Dry-run on the real export reports 303 clients, 957 visits (959 minus 2 legacy appointments without date, reported as skipped), 279 certificates, and 0 clients whose computed debt differs from the legacy balance.
- Running the import twice produces no duplicates.
- Existing tests keep passing; the importer has tests with small fixtures (no real client data in the repo).

## Checks
`npm run typecheck`, `npm test`, `npm run build`, dry-run and real import against a local PGlite copy of the export.

## Progress / evidence
- I3: node analysis of the export, 303/303 balances match `sum(currentAccount)`.
- I1 (delegated, one writer): 5b57813. Migration 0005_legacy_import; `client_contacts` (name, phone, whatsapp, email, position, notes), client city/province/postal_code/latitude/longitude, certificate description/legacy_file_url, nullable unique legacy_id.
- I2 (delegated): 048fa5e. `shared/src/legacy.ts`, 17 tests. Deviations: `legacyPesosToCents` (name clash with money.ts); iva 0 -> consumidor_final (column default); doc type 80/86 -> cuit, 96 -> dni, else none; certificates numbered `L-<legacyId>`.
- I4 (delegated): b972d65. `server/src/services/legacyImport.ts` + CLI `server/src/import-legacy.ts`, `npm run db:import-legacy` (`--dry-run`, `--file`, extra `--allow-mismatches`; any mismatch exits 1 and a real run rolls back). Invoices/payments insert-only, other entities upserted by legacy_id. FIFO allocates each new payment over all open client invoices (same net balance).
- Checks: typecheck exit 0; `npm test` 224/224 (re-run by parent: 224 passed); build ok. Real export on throwaway PGlite: 303 clients, 98 contacts, 957 visits (2 skipped undated), 279 certificates, 5003 invoices (3 zero charges skipped, 0 negative), 4289 payments, 5219 allocations, 4 service types created, 0/303 reconciliation mismatches. Second real run: 0 inserted, 0 mismatches (idempotent).
- I5 (delegated, one writer): `FILES_DIR` config, migration 0006 (`certificates.file_key`, `file_size`), `services/files.ts` (key escape rejected), importer `--files` (plans inside the transaction, writes after commit, sets `file_key` per file, skips same-size files, dry run only counts), owner-only `GET /api/certificates/:id/file`, `hasFile` in the certificate payload, "Ver PDF" link, deploy docs. typecheck ok; `npm test` 241/241; build ok. Real export + bundle on throwaway PGlite/FILES_DIR: dry run 273 to write; real run 273 written, 0 missing; second run 273 skipped, 0 written; 273 PDFs on disk, `%PDF` header; 0/303 mismatches; scratch deleted.

## Next step
PR slicing decision with the user. I6 after the first Railway deploy.

Engram mirror: `odd/legacy-import/tasks`.
