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
- [ ] I1 Schema: `legacy_id` columns, client location fields, `client_contacts` table, certificate description + legacy file url; Drizzle migration. Route: delegated (one writer for I1+I2+I4, 2+ non-trivial files).
- [ ] I2 Pure mapper in `shared/src/legacy.ts` with fixture tests (money, dates, statuses, tax ids, ledger split into invoices/payments). Route: delegated.
- [x] I3 Ledger semantics verified against legacy balances (see above). Route: inline (analysis only).
- [ ] I4 `server/src/import-legacy.ts` + `npm run db:import-legacy` (`--dry-run`, `--file`), transactional, idempotent, reconciliation report (per-client computed debt vs legacy balance). Route: delegated.
- [ ] I5 Oblea PDFs to new storage (needs storage decision: Railway volume vs S3).
- [ ] I6 Run the import on production after the first Railway deploy.

## Acceptance criteria
- Dry-run on the real export reports 303 clients, 959 visits, 279 certificates, and 0 clients whose computed debt differs from the legacy balance.
- Running the import twice produces no duplicates.
- Existing tests keep passing; the importer has tests with small fixtures (no real client data in the repo).

## Checks
`npm run typecheck`, `npm test`, `npm run build`, dry-run and real import against a local PGlite copy of the export.

## Progress / evidence
- I3: node analysis of the export, 303/303 balances match `sum(currentAccount)`.

## Next step
I1+I2+I4 with one delegated writer.

Engram mirror: `odd/legacy-import/tasks`.
